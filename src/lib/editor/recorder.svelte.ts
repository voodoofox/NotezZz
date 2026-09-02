// Voice-memo recorder owned by the Editor. Everything with a lifetime lives
// here — MediaRecorder, its mic stream, the seconds timer — so a single
// cancel() can release it all. The Editor is remounted on every note switch
// ({#key note.id}); before this existed the old recorder kept running (OS mic
// light on, timer ticking) and its eventual onstop inserted into a destroyed
// TipTap instance.

export class VoiceRecorder {
  recording = $state(false);
  seconds = $state(0);

  #rec: MediaRecorder | null = null;
  #stream: MediaStream | null = null;
  #timer: ReturnType<typeof setInterval> | undefined;
  #chunks: Blob[] = [];
  #cancelled = false;

  /** Ask for the mic and start. Rejects if the mic is unavailable/denied. */
  async start(onDone: (dataUrl: string) => void): Promise<void> {
    if (this.recording) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : undefined;
    // 32kbps opus: perfectly fine for voice, tiny files (~4KB/s).
    const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 });
    this.#stream = stream;
    this.#rec = rec;
    this.#chunks = [];
    this.#cancelled = false;
    rec.ondataavailable = (e) => e.data.size && this.#chunks.push(e.data);
    rec.onstop = () => {
      // cancel() releases synchronously and nulls #rec, so a stale onstop
      // (or one from a recorder that has since been replaced) delivers nothing.
      if (this.#rec !== rec || this.#cancelled) return;
      const chunks = this.#chunks;
      this.#release();
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') onDone(reader.result);
      };
      reader.readAsDataURL(blob);
    };
    rec.start(1000);
    this.seconds = 0;
    this.#timer = setInterval(() => (this.seconds += 1), 1000);
    this.recording = true;
  }

  /** Finish: onDone receives the memo once the encoder has flushed. */
  stop() {
    if (this.#rec && this.#rec.state !== 'inactive') this.#rec.stop();
  }

  /** Abandon: nothing is delivered, and the mic is released right now. */
  cancel() {
    this.#cancelled = true;
    // Release synchronously rather than waiting for onstop — the mic light
    // must go out the moment the note is left, not after the encoder flushes.
    if (this.#rec && this.#rec.state !== 'inactive') this.#rec.stop();
    this.#release();
  }

  #release() {
    clearInterval(this.#timer);
    this.#timer = undefined;
    this.#stream?.getTracks().forEach((t) => t.stop());
    this.#stream = null;
    this.#rec = null;
    this.#chunks = [];
    this.recording = false;
  }
}
