import {
	EventLike,
	ReadyState,
} from '../retransmitting-websocket/src/RetransmittingWebSocket.ts'

import * as messages from '../messages.ts'
import * as utils from '../utils.ts'
import {
	WebSocketBase
} from '../websocketbase.ts'

type ConfigType = {
	establishTimeoutMs: number,
	closeTimeoutMs: number,
}

type UnderlyingSender = (message: messages.BccMsg) => void;

type BccMsgHandlerFuncType = (event: MessageEvent<messages.BccMsg>) => void;

// WebSocket API via BroadcastChannel tunnel
export class ActiveLogicalWebSocket extends WebSocketBase {
	public readonly channelUUID = crypto.randomUUID();
	private establishTimeoutTask?: ReturnType<typeof setTimeout>;

	private _config: ConfigType;
	private lowLevelSend: UnderlyingSender;

	get config(): ConfigType {
		return this._config;
	}

	constructor(
		lowLevelSend: UnderlyingSender, 
		handlerAdder: (handler: BccMsgHandlerFuncType) => void,
		handlerRemover: (handler: BccMsgHandlerFuncType) => void,
		) {
		super();

		this.lowLevelSend = lowLevelSend;
		
		const handler = this.bccMsgHandler.bind(this);
		handlerAdder(handler);
		this.addEventListener('close', () => {
			handlerRemover(handler);
		})

		this._config = {
			establishTimeoutMs: 1000,
			closeTimeoutMs: 1000,
		}

		this.establishTimeoutTask = setTimeout(() => {
			utils.log('Unable to open a LogicalWebSocket, timeout!');
			this.establishTimeoutTask = undefined;
			this.closeInternal({
				type: 'close',
				code: 1002,
				reason: 'CONNECTING timeout',
				target: this,
				wasClean: false,
			});
		}, this.config.establishTimeoutMs);

		const channelNewMsg: messages.BccMsgOutbound = {
			type: messages.BccMsgOutboundType.NEW,
			channelUUID: this.channelUUID,
		}
		this.lowLevelSend(channelNewMsg);
	}

	close(code = 1000, reason = ''): void {
		if (this._readyState === ReadyState.CONNECTING || this._readyState === ReadyState.OPEN) {
			const channelCloseMsg: messages.BccMsgOutbound = {
				type: messages.BccMsgOutboundType.CLOSE_OUTBOUND,
				channelUUID: this.channelUUID,
			}
			this.lowLevelSend(channelCloseMsg);
		}

		super.close(code, reason);
	}

	send(dataBody: ArrayBufferLike | string): void {
		
	}

	private bccMsgHandler(event: MessageEvent<messages.BccMsg>) {
		if (event.data.type === messages.BccMsgInboundType.MEDIUM_BREAK) {
			this.mediumBreak();
			return;
		}

		if (event.data.channelUUID !== this.channelUUID) {
			// Ignore the message if we are not the recipient.
			return;
		}

		switch (event.data.type) {
			case messages.BccMsgInboundType.CREATED: {
				clearTimeout(this.establishTimeoutTask);
				this._readyState = ReadyState.OPEN;

				const wsEvent: EventLike = {
					type: 'open',
					target: this
				};
				this.triggerEvent(wsEvent);
				break;
			}

			case messages.BccMsgInboundType.CLOSE_INBOUND: {
				this.lowLevelSend({
					type: messages.BccMsgInboundType.CLOSED_INBOUND,
					channelUUID: this.channelUUID,
				});

				this.closeInternal({
					type: 'close',
					code: 1000,
					reason: '',
					target: this,
					wasClean: true,
				});
				break;
			}

			case messages.BccMsgInboundType.CLOSED_INBOUND: {
				if (this.pendingCloseEvent)
					this.closeInternal(this.pendingCloseEvent);
				break;
			}
			default:
				break;
		}
	}
}
