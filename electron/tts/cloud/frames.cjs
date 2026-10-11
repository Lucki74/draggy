/** Cuts a byte stream of 16-bit mono PCM into fixed frames. A trailing odd byte waits for the next
 * chunk, so a sample is never split. */

const SAMPLE_RATE = 24000;
/** 40 ms of 16-bit mono, the frame size the player expects. */
const FRAME_BYTES = (SAMPLE_RATE / 1000) * 40 * 2;

function createFramer(onFrames) {
  let pending = Buffer.alloc(0);
  let frames = 0;
  const emit = (bytes) => {
    frames++;
    onFrames?.(new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)));
  };
  return {
    push(chunk) {
      pending = Buffer.concat([pending, Buffer.from(chunk)]);
      while (pending.length >= FRAME_BYTES) {
        emit(pending.subarray(0, FRAME_BYTES));
        pending = pending.subarray(FRAME_BYTES);
      }
    },
    end() {
      const whole = pending.length - (pending.length % 2);
      if (whole > 0) emit(pending.subarray(0, whole));
      pending = Buffer.alloc(0);
      return frames;
    },
  };
}

module.exports = { createFramer, SAMPLE_RATE, FRAME_BYTES };
