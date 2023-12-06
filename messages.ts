import * as utils from './utils.ts'

/**
 * byte 7: level message, 0 = low, 1 = high
 * byte 6: direction, 0 = A>O, 1 = A<O
 * byte 5-0: message identifier
 */
export enum BccMsgType {
	PING = 0b00000000,

	PONG = 0b01000000,
	MEDIUM_BREAK = 0b01000001,

	NEW = 0b10000000,
	DATA_OUTBOUND,
	CLOSE_OUTBOUND,
	CLOSED_OUTBOUND,

	CREATED = 0b11000000,
	DATA_INBOUND,
	CLOSED_INBOUND,
	CLOSE_INBOUND,
}

type BccMsgClose = {
	code: number,
	reason: string
}

interface BccMsgDataMap {
	[BccMsgType.PING]: undefined,

	[BccMsgType.PONG]: undefined,
	[BccMsgType.MEDIUM_BREAK]: undefined,

	[BccMsgType.NEW]: string,
	[BccMsgType.DATA_OUTBOUND]: ArrayBufferLike | string,
	[BccMsgType.CLOSE_OUTBOUND]: BccMsgClose,
	[BccMsgType.CLOSED_OUTBOUND]: undefined,

	[BccMsgType.CREATED]: undefined,
	[BccMsgType.DATA_INBOUND]: ArrayBufferLike | string,
	[BccMsgType.CLOSED_INBOUND]: undefined,
	[BccMsgType.CLOSE_INBOUND]: BccMsgClose,
}

export type BccMsgTypeWithData = BccMsgType.NEW | BccMsgType.DATA_OUTBOUND | BccMsgType.DATA_INBOUND;
export type BccMsgTypeClose = BccMsgType.CLOSE_INBOUND | BccMsgType.CLOSE_OUTBOUND;

/**
 * BroadcastChannelMessage
 */
export interface BccMsg<T extends keyof BccMsgDataMap = BccMsgType> {
	type: T,
	id: number,
	channelUUID: string,
	data: BccMsgDataMap[T],
}

export function getBccMsgData<T extends keyof BccMsgDataMap>(message: BccMsg): BccMsgDataMap[T] {
	return (message as BccMsg<T>).data;
}

function isMsgContainsData(message: BccMsg) {
	return message.type === BccMsgType.NEW ||
		message.type === BccMsgType.DATA_OUTBOUND ||
		message.type === BccMsgType.DATA_INBOUND;
}

function isMsgClose(message: BccMsg) {
	return message.type === BccMsgType.CLOSE_OUTBOUND 
		|| message.type === BccMsgType.CLOSE_INBOUND;
}

/**
 * Low level messages does not increase rx or tx counter.
 * @param message 
 * @returns 
 */
export function isMsgLowLevel(message: BccMsg) {
	return message.type === BccMsgType.PING ||
		message.type === BccMsgType.PONG ||
		message.type === BccMsgType.MEDIUM_BREAK;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Encode a BccMsg into a WebSocket message.
 * 
 * Format (ArrayBuffer):
 * 
 * Header:
 * 1. 1 byte of message type
 * 2. 2 byte of message id, big-endian
 * 3. 16 bytes of uuid
 * 
 * New/Data Message:
 * 1. 1 byte of data type
 * 2. followed by data (Binary / UTF8 encoded string)
 * 
 * Close Message:
 * 1. 2 bytes of close code, big-endian
 * 2. followed by the close reason, a UTF8 encoded string
 * @param message 
 */
export function encodeBccMsg(message: BccMsg): Uint8Array {
	const type: number = message.type;
	const channelUUID = utils.uuidStrToBytes(message.channelUUID);
	// We simply drop the direction field

	let isBinary = true;
	let payload: ArrayBufferLike | null = null;
	let msgLength = 19;
	if (isMsgContainsData(message)) {
		const data = getBccMsgData<BccMsgTypeWithData>(message);
		if (typeof data === 'string') {
			payload = textEncoder.encode(data).buffer;
			isBinary = false;
		} else {
			payload = data;
			isBinary = true;
		}
		msgLength += 1 + payload.byteLength;
	} else if (isMsgClose(message)) {
		const closeMsg = getBccMsgData<BccMsgTypeClose>(message);
		payload = textEncoder.encode(closeMsg.reason).buffer;
		msgLength += 2 + payload.byteLength;
	}

	const buffer = new Uint8Array(msgLength);
	buffer[0] = type;
	buffer[1] = (message.id >> 8) & 0xFF;
	buffer[2] = message.id & 0xFF;
	buffer.set(new Uint8Array(channelUUID), 3);

	if (isMsgContainsData(message)) {
		buffer[19] = isBinary ? 1 : 0;
		if (payload != null) {
			buffer.set(new Uint8Array(payload), 20);
		}
	} else if (isMsgClose(message)) {
		const closeMsg = getBccMsgData<BccMsgTypeClose>(message);
		buffer[19] = (closeMsg.code >> 8) & 0xFF;
		buffer[20] = closeMsg.code & 0xFF;
		if (payload != null) {
			buffer.set(new Uint8Array(payload), 21);
		}
	}
	return buffer;
}

export function decodeBccMsg(buffer: Uint8Array): BccMsg {
	const bccMsg: BccMsg = {
		type: buffer[0],
		id: ((buffer[1] << 8) | buffer[2]) & 0xFFFF,
		channelUUID: utils.uuidStrFromBytes(buffer, 3),
		data: undefined
	};

	if (isMsgContainsData(bccMsg)) {
		const isBinary = buffer[19] > 0;
		if (isBinary) {
			const payload = new Uint8Array(buffer.byteLength - 20);
			payload.set(buffer.slice(20), 0);
			bccMsg.data = payload;
		} else {
			bccMsg.data = textDecoder.decode(buffer.slice(20));
		}
	} else if (isMsgClose(bccMsg)) {
		bccMsg.data = {
			code: ((buffer[19] << 8) | buffer[20]) & 0xFFFF,
			reason: textDecoder.decode(buffer.slice(21)),
		}
	}

	return bccMsg;
}

export type BccMsgSender = <T extends keyof BccMsgDataMap>(type: T, data: BccMsgDataMap[T]) => void;

export function createOrderedSender(lowLevelSend: (message: BccMsg) => void, channelUUID: string): BccMsgSender {
	let id = 0;

	return <T extends keyof BccMsgDataMap>(type: T, data: BccMsgDataMap[T]) => {
		const bccMsg:BccMsg<T> = {
			type,
			id,
			channelUUID,
			data,
		}
		id++;
		lowLevelSend(bccMsg);
	};
}

export type BccMsgConsumer = (message: BccMsg) => void;

function isMsgIdLaterThan(msgId: number, ref: number) {
	return msgId > ref;
}

export function createOrderedReceiver(handler: BccMsgConsumer, channelUUID: string): BccMsgConsumer {
	let id = 0;
	const recvBuf:BccMsg[] = [];

	return (message) => {
		if (isMsgLowLevel(message)) {
			// Do not count low-level messages in id, process them directly
			handler(message);
			return;
		}

		if (message.channelUUID !== channelUUID) {
			// Ignore the message if we are not the recipient.
			return;
		}

		if (message.id == id) {
			// First, we process the current incoming message.
			log(`Handle:`, message);
			handler(message);

			// Then, increase our receiving id expectation by 1.
			id++;

			// Finally, we process buffer messages that arrive early, if any.
			let bufferedMsg = recvBuf.shift(); // Dequeue
			while (bufferedMsg) {
				if (isMsgIdLaterThan(bufferedMsg.id, id)) {
					// We encounter a gap in the buffer
					// The last dequeued message is too early to process, put it back
					recvBuf.unshift(bufferedMsg);
					return;
				}
				log(`Handle:`, bufferedMsg);
				handler(bufferedMsg);
				id++;
				bufferedMsg = recvBuf.shift();
			}
		} else if (isMsgIdLaterThan(message.id, id)) {
			// Insert the message into the buffer in order
			let i = 0;
			for (i = 0; i < recvBuf.length; i++) {
				const bufferedMsg = recvBuf[i];
				if (isMsgIdLaterThan(bufferedMsg.id, message.id)) {
					break;
				} else if (bufferedMsg.id === message.id) {
					utils.warn(`A>O Dupe message: ${message.id}, expect: ${id}`);
					return;
				}
			}
			log(`Enqueue (expect ${id}):`, message);
			recvBuf.splice(i, 0, message);
		} else {
			// event.data.id < recvId
			// We received a duplicated message, discard
			utils.warn(`A>O Late message: ${message.id}, expect: ${id}`);
		}
	}
}

export function log(prefix: string, message: BccMsg) {
	const typeStr = BccMsgType[message.type];
	let description = '';
	if (isMsgContainsData(message)) {
		const data = getBccMsgData<BccMsgTypeWithData>(message);
		if (typeof data == 'string') {
			if (data.length < 80) {
				description = `string(${data.length}): ${data}`;
			} else {
				description = `string(${data.length})`;
			}
		} else {
			description = `arraybuffer(${data.byteLength})`;
		}
	}
	utils.debug(prefix, message.channelUUID.substring(0, 4), message.id, typeStr, description);
}

/**
 * NOT ACCURATE! FOR SPEED LIMIT ONLY!
 * @param message 
 * @returns the effective byte length of a BccMsg. Only data messages are taken into account.
 */
export function getEffectiveByteLength(message: BccMsg) {
	if (message.type != BccMsgType.DATA_INBOUND && message.type != BccMsgType.DATA_OUTBOUND) {
		return 0;
	}

	const data = getBccMsgData<BccMsgTypeWithData>(message);
	if (typeof data === 'string') {
		return data.length;
	} else {
		return data.byteLength;
	}
}