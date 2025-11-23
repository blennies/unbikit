/**
 * Audio worklet
 */
interface AudioPacket {
  audioData: Float32Array[];
  numChannels: number;
  sampleRate: number;
  trackIndex: number;
}
interface PlayAudioPacketEvent {
  type: "playAudioPacket";
  payload: AudioPacket;
}
interface DiscardAudioPacketsEvent {
  type: "discardAudioPackets";
  payload: null;
}
type EventData = DiscardAudioPacketsEvent | PlayAudioPacketEvent;

class BikAudioProcessor extends AudioWorkletProcessor {
  #queue: AudioPacket[] = [];
  #curPos: number = 0; // position in top-of-queue sample

  constructor() {
    super();
    this.port.onmessage = (evt) => {
      const evtData = evt.data as EventData | undefined;
      if (evtData?.type === "playAudioPacket") {
        const payload = evt.data.payload;
        if (!this.#queue.length) {
          this.#curPos = 0;
        }
        this.#queue.push(payload);
      } else if (evtData?.type === "discardAudioPackets") {
        this.#queue = [];
        this.#curPos = 0;
      }
    };
  }

  process(
    _inputList: Float32Array[][],
    outputList: Float32Array[][],
    _parameters: Record<string, Float32Array>,
  ): boolean {
    if (this.#queue.length > 0 && outputList.length > 0) {
      const outputChannels = outputList[0];
      if (outputChannels?.[0]) {
        let queueEntry = this.#queue[0];
        let queueAudioData = queueEntry?.audioData;
        let outPos = 0;
        while (queueAudioData?.[0] && outPos < outputChannels[0].length) {
          const queueLenLeft = (queueAudioData[0]?.length ?? 0) - this.#curPos;
          const samplesToCopy = Math.min(queueLenLeft, outputChannels[0].length - outPos);
          if (samplesToCopy > 0) {
            outputChannels[0].set(
              queueAudioData[0].subarray(this.#curPos, this.#curPos + samplesToCopy),
              outPos,
            );

            for (const [channelIndex, channel] of outputChannels.entries()) {
              const audioData = queueAudioData[channelIndex];
              if (channelIndex > 0 && audioData) {
                channel.set(
                  audioData.subarray(this.#curPos, this.#curPos + samplesToCopy),
                  outPos,
                );
              }
            }

            outPos += samplesToCopy;
            this.#curPos += samplesToCopy;
          }

          if (this.#curPos >= queueAudioData[0].length) {
            this.#curPos = 0;
            this.#queue.shift();
            queueEntry = this.#queue[0];
            queueAudioData = queueEntry?.audioData;
          }
        }
      }
    }
    return true;
  }
}
registerProcessor("bik-audio-processor", BikAudioProcessor);
