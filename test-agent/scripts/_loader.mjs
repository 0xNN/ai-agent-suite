const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const colors = [31, 32, 33, 34, 35, 36];
const dim = "\x1b[2m";
const reset = "\x1b[0m";

const messagePools = {
  review: [
    "Scanning code for issues...",
    "Analyzing code patterns...",
    "Checking for bugs...",
    "Reviewing security...",
    "Evaluating performance...",
    "Looking for dead code...",
    "Consulting AI...",
    "Warming up the neural network...",
    "Untangling your spaghetti code...",
    "Counting the red flags...",
    "Reading between the lines...",
    "Judging your variable names...",
    "Hunting for undefined is not a function...",
    "Sipping virtual coffee...",
    "Running the gauntlet...",
    "Checking if it compiles on my machine...",
    "Feeling a bug in the air...",
    "Almost there...",
    "Double-checking for sneaky semicolons...",
    "That looks sus...",
  ],
  commit: [
    "Reading git diff...",
    "Analyzing changes...",
    "Crafting commit message...",
    "Summarizing your changes...",
    "Putting words in your mouth...",
    "Consulting AI...",
    "Finding the right emoji...",
    "Deciding between feat and chore...",
    "Polishing the message...",
    "Making your code sound important...",
    "That's a lot of deletions...",
    "Almost there...",
    "Wrapping it in a nice commit message...",
    "Trying not to judge your commit history...",
  ],
  fix: [
    "Reading review report...",
    "Analyzing findings...",
    "Generating fixes...",
    "Applying patches...",
    "Undoing your mistakes...",
    "Consulting AI...",
    "Rolling up sleeves...",
    "Rewriting history...",
    "Sometimes it's best to start over...",
    "Channeling inner senior dev...",
    "This will only hurt for a moment...",
    "Patch incoming...",
    "Making it less wrong...",
    "Glueing the pieces back together...",
    "Trust me, I'm an AI...",
    "Fixing bugs one line at a time...",
    "Almost there...",
    "That fix was oddly satisfying...",
    "Getting paid per line removed...",
  ],
  test: [
    "Reading review report...",
    "Analyzing source code...",
    "Writing test cases...",
    "Covering edge cases...",
    "Generating assertions...",
    "Consulting AI...",
    "Making sure it's testable...",
    "Mocking dependencies...",
    "Writing the test that catches the bug...",
    "Achieving 100% coverage...",
    "Trust me, it's tested...",
    "The test giveth and the test taketh away...",
    "Almost there...",
    "That test is beautiful...",
    "Did someone say TDD?",
    "Better safe than sorry...",
    "Testing in production is not testing...",
    "Getting paid per assertion...",
  ],
};

const ansi = (code, text) => `\x1b[${code}m${text}${reset}`;

export class Loader {
  constructor(pool = "review") {
    this.frames = frames;
    this.messages = messagePools[pool] ?? messagePools.review;
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

    this.interval = setInterval(() => {
      this._tick();
      this.frameIndex++;
    }, 120);
  }

  _tick() {
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const time = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

    const frame = this.frames[this.frameIndex % this.frames.length];
    const msg = this.messages[this.msgIndex];
    const color = colors[this.msgIndex % colors.length];

    const label = this.currentText ? ansi(33, this.currentText) + " " : "";

    process.stdout.write(
      `\r${ansi(36, frame)} ${dim}${time}${reset}  ${label}${ansi(color, msg)}`
    );

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
