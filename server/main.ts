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

const inboundChannel = new BroadcastChannel('portal_inbound');
const outboundChannel = new BroadcastChannel('portal_outbound');

function handleWsIn(lws: ActiveLogicalWebSocket, webSocket: WebSocket) {
	lws.onopen = () => {
		utils.log('LWS Opened');
	}

	lws.onmessage = (event) => {
		webSocket.send(event.data);
	}

	lws.onclose = (event) => {
		const code = utils.canWebSocketReturn(event.code) ? event.code : 1000;
		utils.log(lws.channelUUID.substring(0, 4), 'LWS Closed with', code, event.reason);
		webSocket.close(code, event.reason);
	}

	webSocket.onopen = () => {

	};

	webSocket.onmessage = (event) => {
		lws.send(event.data);
	}

	webSocket.onclose = (event) => {
		utils.log(`WsIn websocket close: ${event.code} ${event.reason}`)
		lws.close(event.code, event.reason);
	}

	webSocket.onerror = (event) => {
		utils.log(`WsIn websocket error: ${event}`)
	}
}

async function handleWsInRequest(req: Request, destURL: string) {
	if (req.headers.get("upgrade") != "websocket") {
		return new Response(null, { status: 501 });
	}

	let establishedPromise: Promise<void> | null = null;
	const lws = new ActiveLogicalWebSocket(
		(message) => {
			messages.log('A>O AGT', message);
			outboundChannel.postMessage(message);
		},
		(me, handler) => {
			function bccMsgHandler(event: MessageEvent<messages.BccMsg>) {
				messages.log('A<O AGT', event.data);
				handler(event.data);
			}
			inboundChannel.addEventListener('message', bccMsgHandler), 
			me.addEventListener('close', () => {
				inboundChannel.removeEventListener('message', bccMsgHandler);
			});

			establishedPromise = new Promise<void>((resolve, reject) => {
				me.onmessage = (event) => {
					// When the remote WebSocket is opened, the outlet echos back the destURL
					if (event.data === destURL) {
						// Remote WebSocket is opened, the LWS channel is now transparent.
						resolve();
					} else {
						// Reject if we receive garbage, this should not happen!
						reject();
					}
				};
				me.onclose = () => reject();
			});
		},
		destURL
	);

	try {
		// Wait until the remote WebSocket at the outlet is opened.
		await establishedPromise;

		const upgradeResult = Deno.upgradeWebSocket(req);
		upgradeResult.socket.binaryType = 'arraybuffer';
		handleWsIn(lws, upgradeResult.socket);
		return upgradeResult.response;
	} catch {
		// If the LWS channel cannot establish, return "Gateway Timeout"
		return new Response(null, { status: 504 });
	}
}

async function handleWsOutRequest(req: Request) {
	if (req.headers.get("upgrade") != "websocket") {
		return new Response(null, { status: 501 });
	}

	let listener: undefined | ((event: MessageEvent<messages.BccMsg>) => void) = undefined;
	try {
		await utils.promiseTimeOut(new Promise<void>((resolve) => {
			function pongHandler(event: MessageEvent<messages.BccMsg>) {
				if (event.data.type === messages.BccMsgType.PONG)
					resolve();
			}
			listener = pongHandler;
			inboundChannel.addEventListener('message', pongHandler);

			messages.createOrderedSender(outboundChannel.postMessage, utils.instanceUUID)(messages.BccMsgType.PING, undefined);
		}), 1000);

		if (listener)
			inboundChannel.removeEventListener('message', listener);

		utils.log('There is a connected outlet, kick the new one!')
		return new Response(null, { status: 409 }); // 409 = Conflict
	} catch {
		if (listener)
			inboundChannel.removeEventListener('message', listener);

		const upgradeResult = Deno.upgradeWebSocket(req);
		upgradeResult.socket.binaryType = 'arraybuffer';
		handleBccWsForwarding(upgradeResult.socket);
		return upgradeResult.response;
	}
}

const portString = Deno.env.get("PORT") || '8000';
Deno.serve({port: Number(portString)}, async (req) => {
	const reqURL = new URL(req.url);
	switch (reqURL.pathname) {
		case '/ws_out': 
			return await handleWsOutRequest(req);
		case '/ws_in':
			return await handleWsInRequest(req, reqURL.searchParams.get('dest') || '');
		default:
			return new Response('Http Server!', { status: 200 });
	}
});
