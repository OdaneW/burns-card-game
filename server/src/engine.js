/* The app's own game engine, modes and computer players, loaded on the
   server so online games follow exactly the same rules. Order matters:
   engine, then each mode's rules before its computer player. */
import '../../src/engine/core.js';
import '../../src/engine/session.js';
import '../../src/modes/burns/rules.js';
import '../../src/modes/burns/bot.js';
import '../../src/modes/donkey/rules.js';
import '../../src/modes/donkey/bot.js';
import '../../src/modes/bull/rules.js';
import '../../src/modes/bull/bot.js';
import '../../src/modes/stripme/rules.js';
import '../../src/modes/stripme/bot.js';

export default globalThis.CT;
