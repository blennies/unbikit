/**
 * Audio worklet
 */
class BikAudioProcessor extends AudioWorkletProcessor {
  #queue: Float32Array[][] = [];
  #curPos: number = 0; // position in top-of-queue sample

  constructor() {
    super();
    this.port.onmessage = (evt) => {
      if (evt.data?.type === "playAudioPacket") {
        const payload = evt.data.payload;
        if (!this.#queue.length) {
          this.#curPos = 0;
        }
        this.#queue.push(payload);
      } else if (evt.data?.type === "discardAudioPackets") {
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
        let queueEntry: any | undefined = this.#queue[0];
        let queueAudioData: any[] | undefined = queueEntry?.audioData;
        let outPos = 0;
        while (queueAudioData && outPos < outputChannels[0].length) {
          const queueLenLeft = (queueAudioData[0]?.length ?? 0) - this.#curPos;
          const samplesToCopy = Math.min(queueLenLeft, outputChannels[0].length - outPos);
          if (samplesToCopy > 0) {
            outputChannels[0].set(
              queueAudioData[0].subarray(this.#curPos, this.#curPos + samplesToCopy),
              outPos,
            );

            for (const [channelIndex, channel] of outputChannels.entries()) {
              if (channelIndex > 0 && channelIndex < queueAudioData.length) {
                channel.set(
                  queueAudioData[channelIndex].subarray(this.#curPos, this.#curPos + samplesToCopy),
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
