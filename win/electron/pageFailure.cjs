// Turns a failed page load into a cause the model and the user can act on.

const CAUSES = [
  { match: /ERR_NAME_NOT_RESOLVED|ERR_ADDRESS_UNREACHABLE/, code: "dns", reason: "The site's address could not be found. Check the spelling, or the network may be down." },
  { match: /ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_PROXY/, code: "offline", reason: "There is no working internet connection right now." },
  { match: /ERR_CONNECTION_(REFUSED|RESET|CLOSED|FAILED)|ERR_EMPTY_RESPONSE/, code: "connection", reason: "The site refused or dropped the connection." },
  { match: /ERR_TIMED_OUT|ERR_CONNECTION_TIMED_OUT|timed? ?out/i, code: "timeout", reason: "The site took too long to answer." },
  { match: /ERR_CERT|ERR_SSL|ERR_BAD_SSL/, code: "certificate", reason: "The site's security certificate was rejected." },
  { match: /ERR_ABORTED/, code: "aborted", reason: "The page moved to another address before it finished loading." },
  { match: /Script failed to execute|Object has been destroyed/, code: "script", reason: "The page changed while it was being read." },
];

/** Names why a read failed. The message can echo the address, so only the code goes to the log. */
function classifyPageFailure(error) {
  const text = `${error?.code || ""} ${error?.message || ""}`;
  const found = CAUSES.find((cause) => cause.match.test(text));
  return found ? { code: found.code, reason: found.reason } : { code: "unknown", reason: "The page could not be opened." };
}

module.exports = { classifyPageFailure };
