/**
 * The logger 1.2.7's storage module expects, silenced. Only the storage code
 * is the thing under test.
 */
const quiet = () => {};

module.exports = { log: { info: quiet, warn: quiet, error: quiet, debug: quiet } };
