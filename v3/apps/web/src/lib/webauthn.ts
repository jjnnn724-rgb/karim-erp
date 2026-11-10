/**
 * عميل WebAuthn — طبقة الترجمة الوحيدة بين JSON (base64url) وArrayBuffer.
 *
 * الخادم (`webauthn-routes.js`) يرسل خياراتٍ بصيغة @simplewebauthn/server
 * ويستقبل استجابةً بصيغة AuthenticationResponseJSON. لا شبكة ولا تخزين هنا:
 * التحويل نقي وقابل للاختبار.
 */

export interface WebAuthnOptions {
	challenge: string;
	rpId?: string;
	timeout?: number;
	userVerification?: UserVerificationRequirement;
	allowCredentials?: Array<{
		type?: string;
		id: string;
		transports?: string[];
	}>;
	extensions?: Record<string, unknown>;
}

export interface AssertionJSON {
	id: string;
	rawId: string;
	type: string;
	response: {
		clientDataJSON: string;
		authenticatorData: string;
		signature: string;
		userHandle: string | null;
	};
	clientExtensionResults: Record<string, unknown>;
	authenticatorAttachment?: string;
}

export function b64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
	const normalized = String(value || "")
		.replace(/-/g, "+")
		.replace(/_/g, "/");
	const pad =
		normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
	const binary = atob(normalized + pad);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

export function bytesToB64url(value: ArrayBuffer | Uint8Array): string {
	const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
	let binary = "";
	for (let i = 0; i < bytes.length; i += 1) {
		binary += String.fromCharCode(bytes[i] as number);
	}
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

export function isWebAuthnSupported(win: Window = window): boolean {
	return Boolean(
		win.isSecureContext !== false &&
			"PublicKeyCredential" in win &&
			win.navigator?.credentials &&
			typeof win.navigator.credentials.create === "function" &&
			typeof win.navigator.credentials.get === "function",
	);
}

export function toRequestOptions(
	options: WebAuthnOptions,
): PublicKeyCredentialRequestOptions {
	const publicKey: PublicKeyCredentialRequestOptions = {
		challenge: b64urlToBytes(options.challenge),
		timeout: Number(options.timeout) || 60_000,
		userVerification: options.userVerification ?? "required",
	};
	if (options.rpId) {
		publicKey.rpId = String(options.rpId);
	}
	if (options.extensions) {
		publicKey.extensions =
			options.extensions as AuthenticationExtensionsClientInputs;
	}
	const allow = Array.isArray(options.allowCredentials)
		? options.allowCredentials
		: [];
	if (allow.length) {
		publicKey.allowCredentials = allow.map((entry) => ({
			type: "public-key" as const,
			id: b64urlToBytes(entry.id),
			...(Array.isArray(entry.transports)
				? { transports: entry.transports as AuthenticatorTransport[] }
				: {}),
		}));
	}
	return publicKey;
}

export function serializeAssertion(
	credential: PublicKeyCredential,
): AssertionJSON {
	const response = credential.response as AuthenticatorAssertionResponse;
	return {
		id: credential.id,
		rawId: bytesToB64url(credential.rawId),
		type: credential.type || "public-key",
		response: {
			clientDataJSON: bytesToB64url(response.clientDataJSON),
			authenticatorData: bytesToB64url(response.authenticatorData),
			signature: bytesToB64url(response.signature),
			userHandle: response.userHandle
				? bytesToB64url(response.userHandle)
				: null,
		},
		clientExtensionResults: credential.getClientExtensionResults() as Record<
			string,
			unknown
		>,
		...(credential.authenticatorAttachment
			? { authenticatorAttachment: credential.authenticatorAttachment }
			: {}),
	};
}

/** DOMException → جملة يفهمها المستخدم ويستطيع التصرف بناءً عليها. */
export function describeWebAuthnError(error: unknown): string {
	const name = error instanceof DOMException ? error.name : "";
	if (name === "InvalidStateError") {
		return "هذا الجهاز مسجّل بالفعل لهذا الحساب — سجّل جهازًا آخر.";
	}
	if (name === "NotAllowedError") {
		return "أُلغي التحقق أو انتهت مهلته — أعد المحاولة وامنح الإذن عند طلب المتصفح.";
	}
	if (name === "SecurityError") {
		return "فتح النظام عبر HTTPS من عنوانه الرسمي مطلوب لاستخدام البصمة.";
	}
	if (name === "NotSupportedError") {
		return "هذا المتصفح أو الجهاز لا يدعم الدخول بالبصمة / Face ID.";
	}
	if (name === "AbortError") {
		return "أُلغيت العملية — أعد المحاولة.";
	}
	return error instanceof Error
		? error.message
		: "تعذّر إكمال التحقق بالجهاز — حاول مجددًا.";
}
