const portalChannel = new BroadcastChannel("portal");

enum PortalMessageType {
	WebSocketCreate = 1,
	WebSocketPacket = 2,
	WebSocketClose = 3,
}

interface PortalMessage {
	identifier: string;
	type: PortalMessageType;
}

interface PortalRequest extends PortalMessage {
}

interface PortalResponse extends PortalMessage {

}

function handleWsOut(websocket: WebSocket):void {
	websocket.addEventListener("open", () => {
		console.log("a client connected!");
	});
	
	websocket.addEventListener("message", (event) => {
		if (event.data === "ping") {
			websocket.send("pong");
		}
	});
}

function handleWsIn(websocket: WebSocket):void {

}

function handleWsUpgrade(req: Request, wsHandler: (websocket: WebSocket) => void): Response {
	if (req.headers.get("upgrade") != "websocket") {
		return new Response(null, { status: 501 });
	}

	const upgradeResult = Deno.upgradeWebSocket(req);
	wsHandler(upgradeResult.socket);
	return upgradeResult.response;
}

Deno.serve((req) => {
	const reqURL = new URL(req.url);
	switch (reqURL.pathname) {
		case '/ws_out':
			return handleWsUpgrade(req, handleWsOut);
		case '/ws_in':
			return handleWsUpgrade(req, handleWsIn);
		default:
			return new Response('Http Server!', { status: 200 });
	}
});