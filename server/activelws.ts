import {
	EventLike,
	MessageEventLike,
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

type BccMsgHandlerFuncType = (message: messages.BccMsg) => void;

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
		handlerAdder: (me: ActiveLogicalWebSocket, handler: BccMsgHandlerFuncType) => void,
		destURL = ''
		) {
		super();

		this.lowLevelSend = lowLevelSend;
		handlerAdder(this, this.handleBccMsg.bind(this));

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

		const channelNewMsg: messages.BccMsgNew = {
			type: messages.BccMsgOutboundType.NEW,
			channelUUID: this.channelUUID,
			data: destURL
		}
		this.lowLevelSend(channelNewMsg);
	}

	close(code = 1000, reason = ''): void {
		if (this._readyState === ReadyState.CONNECTING || this._readyState === ReadyState.OPEN) {
			const channelCloseMsg: messages.BccMsgClose = {
				type: messages.BccMsgOutboundType.CLOSE_OUTBOUND,
				channelUUID: this.channelUUID,
			}
			this.lowLevelSend(channelCloseMsg);
		}

		super.close(code, reason);
	}

	send(dataBody: ArrayBufferLike | string): void {
		this.lowLevelSend({
			type: messages.BccMsgOutboundType.DATA_OUTBOUND,
			channelUUID: this.channelUUID,
			data: dataBody,
		} as messages.BccMsgData);
	}

	private handleBccMsg(message: messages.BccMsg) {
		if (message.type === messages.BccMsgInboundType.MEDIUM_BREAK) {
			this.mediumBreak();
			return;
		}

		if (message.channelUUID !== this.channelUUID) {
			// Ignore the message if we are not the recipient.
			return;
		}

		switch (message.type) {
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

			case messages.BccMsgInboundType.DATA_INBOUND: {
				const dataMsg = <messages.BccMsgData> message;

				const wsEvent: MessageEventLike = {
					type: 'message',
					target: this,
					data: dataMsg.data,
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
