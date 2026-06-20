const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const colors = [31, 32, 33, 34, 35, 36];
const dim = "\x1b[2m";
const reset = "\x1b[0m";

const messagePools = {
  diff: [
    "Reading git diff...",
    "Analyzing changes...",
    "Checking for regressions...",
    "Reviewing new code...",
    "Spotting potential bugs...",
    "Consulting AI...",
    "These changes look interesting...",
    "That's a lot of deletions...",
    "Nice commit message potential...",
    "Checking if it breaks anything...",
    "Almost there...",
    "One does not simply push without review...",
    "Making sure it compiles...",
  ],
};

const ansi = (code, text) => `\x1b[${code}m${text}${reset}`;

export class Loader {
  constructor(pool = "diff") {
    this.frames = frames;
    this.messages = messagePools[pool] ?? messagePools.diff;
    this.messages = [...this.messages];
    this.startTime = null;
    this.frameIndex = 0;
    this.msgIndex = 0;
    this.interval = null;
    this.currentText = "";
  }

  start(text) {
    this.startTime = Date.now();
    this.currentText = text ?? "";
    this._shuffle(this.messages);
    this.interval = setInterval(() => { this._tick(); this.frameIndex++; }, 120);
  }

  _tick() {
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const time = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
    const frame = this.frames[this.frameIndex % this.frames.length];
    const msg = this.messages[this.msgIndex];
    const color = colors[this.msgIndex % colors.length];
    const label = this.currentText ? ansi(33, this.currentText) + " " : "";
    process.stdout.write(`\r${ansi(36, frame)} ${dim}${time}${reset}  ${label}${ansi(color, msg)}`);
    if (this.frameIndex > 0 && this.frameIndex % 8 === 0) {
      this.msgIndex = (this.msgIndex + 1) % this.messages.length;
    }
  }

  stop(message) {
    clearInterval(this.interval);
    process.stdout.write(`\r\x1b[K`);
    if (message) console.log(ansi(32, "✓") + " " + message);
  }

  fail(message) {
    clearInterval(this.interval);
    process.stdout.write(`\r\x1b[K`);
    if (message) console.log(ansi(31, "✗") + " " + message);
  }

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
}
