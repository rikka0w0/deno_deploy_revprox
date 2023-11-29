import * as utils from '../utils.ts'
import * as messages from '../messages.ts'
import {
	handleBccWsForwarding
} from './forwarder.ts'
import {
	ActiveLogicalWebSocket
} from './activelws.ts'

if (Deno.env.get("DENO_REGION")) {
	utils.log('Instance Start on Deno Deploy!');
} else {
	utils.log('Instance Start on NodeJS!');
}

const broadcastChannel = new BroadcastChannel('portal_inbound');

function broadcast(message: messages.BccMsg) {
	const broadcastChannel = new BroadcastChannel('portal_outbound');
	broadcastChannel.postMessage(message);
	broadcastChannel.close();
}

function handleWsIn(websocket: WebSocket, destURL: string): void {
	const lws = new ActiveLogicalWebSocket(broadcast, 
		(me, handler) => {
			function bccMsgHandler(event: MessageEvent<messages.BccMsg>) {
				handler(event.data);
			}
			broadcastChannel.addEventListener('message', bccMsgHandler), 
			me.addEventListener('close', () => {
				broadcastChannel.removeEventListener('message', bccMsgHandler);
			});
		},
		destURL
	);

	lws.onopen = () => {
		utils.log('LWS Opened');
	}

	lws.onmessage = (event) => {
		websocket.send(event.data);
	}

	lws.onclose = (event) => {
		utils.log('LWS closed', event);
		websocket.close(event.code, event.reason);
	}

	websocket.onopen = () => {

	};

	websocket.onmessage = (event) => {
		utils.log('WsIn Data', event.data);
		lws.send(event.data);
	}

	websocket.onclose = (event) => {
		lws.close();
	}
}

function handleWsUpgrade(req: Request, wsHandler: (websocket: WebSocket, ...args: any[]) => void, ...args: any[]): Response {
	if (req.headers.get("upgrade") != "websocket") {
		return new Response(null, { status: 501 });
	}

	const upgradeResult = Deno.upgradeWebSocket(req);
	upgradeResult.socket.binaryType = 'arraybuffer';
	wsHandler(upgradeResult.socket, ...args);
	return upgradeResult.response;
}

const portString = Deno.env.get("PORT") || '8000';
Deno.serve({port: Number(portString)}, async (req) => {
	const reqURL = new URL(req.url);
	switch (reqURL.pathname) {
		case '/ws_out': {
			let listener: undefined | ((event: MessageEvent<messages.BccMsg>) => void) = undefined;
			try {
				await utils.promiseTimeOut(new Promise<void>((resolve) => {
					function pongHandler(event: MessageEvent<messages.BccMsg>) {
						if (event.data.type === messages.BccMsgInboundType.PONG)
							resolve();
					}
					listener = pongHandler;
					broadcastChannel.addEventListener('message', pongHandler);

					broadcast({
						type: messages.BccMsgOutboundType.PING,
						channelUUID: utils.instanceUUID,
					});
				}), 1000);

				if (listener)
					broadcastChannel.removeEventListener('message', listener);

				utils.log('There is a connected outlet, kick the new one!')
				return new Response(null, { status: 409 }); // 409 = Conflict
			} catch {
				if (listener)
					broadcastChannel.removeEventListener('message', listener);

				return handleWsUpgrade(req, handleBccWsForwarding);
			}
		}
		case '/ws_in': {
			const destURL = reqURL.searchParams.get('dest') || '';
			return handleWsUpgrade(req, handleWsIn, destURL);
		}
		default:
			return new Response('Http Server!', { status: 200 });
	}
});
