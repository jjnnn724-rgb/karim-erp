import { createLazyRoute } from "@tanstack/react-router";
import { ScreenGate } from "../components/ScreenGate";
import { Mudad } from "./Mudad";

export const Route = createLazyRoute("/mudad")({
	component: () => (
		<ScreenGate screen="mudad">
			<Mudad />
		</ScreenGate>
	),
});
