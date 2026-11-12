import { createLazyRoute } from "@tanstack/react-router";
import { ScreenGate } from "../components/ScreenGate";
import { VatReturn } from "./VatReturn";

export const Route = createLazyRoute("/vat-return")({
	component: () => (
		<ScreenGate screen="vat-return">
			<VatReturn />
		</ScreenGate>
	),
});
