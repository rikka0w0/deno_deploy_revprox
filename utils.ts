export const instanceUUID = crypto.randomUUID();
export const instanceUUIDShort = instanceUUID.substring(0, 4);

export function base64ToArrayBuffer(base64Str: string): ArrayBuffer {
	if (!base64Str) {
		throw new Error("Empty Base64 input");
	}

	// go use modified Base64 for URL rfc4648 which js atob not support
	base64Str = base64Str.replace(/-/g, '+').replace(/_/g, '/');
	const decode = atob(base64Str);
	const arryBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
	return arryBuffer.buffer;
}

/**
 * Convert a decimal number to a hex string.
 * @param byteIn 
 * @returns e.g., 1 gives 01, 255 gives ff
 */
export function byteToHexStr(byteIn: number): string {
	return (byteIn + 256).toString(16).slice(1);
}

/**
 * Function to convert UUID string to ArrayBuffer
 * @param uuid 
 * @returns 
 */
export function uuidStrToBytes(uuid: string): ArrayBuffer {
	const hex = uuid.replace(/-/g, ''); // Remove dashes from the UUID string
	const buffer = new ArrayBuffer(16);
	const view = new DataView(buffer);

	for (let i = 0; i < 16; i++) {
		view.setUint8(i, parseInt(hex.substr(i * 2, 2), 16));
	}

	return buffer;
}

/**
 * Function to convert ArrayBuffer to UUID string
 * @param buffer 
 * @returns 
 */
export function uuidStrFromBytes(buffer: ArrayBufferLike, offset = 0): string {
	const bytes = new Uint8Array(buffer);
	let uuid = '';

	for (let i = 0; i < 16; i++) {
		let byteHex = bytes[i + offset].toString(16).toLowerCase();
		if (byteHex.length === 1) {
			byteHex = '0' + byteHex; // Ensure byte is always represented by two characters
		}
		uuid += byteHex;
		if (i === 3 || i === 5 || i === 7 || i === 9) {
			uuid += '-';
		}
	}

	return uuid;
}

export function dateTimeString() {
	const now = new Date();
    
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    const formattedDateTime = `[${year}-${month}-${day} ${hours}:${minutes}:${seconds}]`;
    return formattedDateTime;
}

export function warn(...data: any[]) {
	console.warn(dateTimeString(), instanceUUIDShort, ...data);
} 

export function log(...data: any[]) {
	console.log(dateTimeString(), instanceUUIDShort, ...data);
} 

export function debug(...data: any[]) {
	console.debug(dateTimeString(), instanceUUIDShort, ...data);
}

export function promiseTimeOut<T=any>(request: Promise<T>, timeout: number, timeoutError?: any) {
	return new Promise<T>((resolve, reject) => {
		let resolved = false;

		const timeoutTask = setTimeout(() => {
			if (!resolved) {
				reject(timeoutError);
			}
		}, timeout);

		request.then((result) => {
			resolved = true;
			clearTimeout(timeoutTask);
			resolve(result);
		}).catch((error) => {
			resolved = true;
			clearTimeout(timeoutTask);
			reject(error);
		});
	});
}

export function canWebSocketReturn(code: number) {
	return code === 1000 || (code >= 3000 && code < 5000);
}
