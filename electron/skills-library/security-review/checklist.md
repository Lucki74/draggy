# Security checklist

## Injection
- SQL/NoSQL: queries built by string concatenation or template strings with input
- Shell: exec/system/spawn with a shell and input in the command string
- Code: eval, Function(), exec(), pickle/yaml.load/unserialize on untrusted data
- Templates: unescaped output (dangerouslySetInnerHTML, |safe, v-html, innerHTML)
- Path traversal: user-controlled paths joined without resolving and checking the root
- SSRF: server fetching URLs from input without an allowlist or private-address block
- Header/log injection: newlines from input in headers or log lines

## Access control
- Every endpoint checks authentication AND authorisation for the specific object (IDOR)
- Admin functions not reachable by changing a parameter or URL
- Client-side checks duplicated on the server

## Authentication and sessions
- Passwords hashed with bcrypt, scrypt or argon2, never plain or fast hashes
- Session tokens random, rotated on login, invalidated on logout
- Rate limiting on login and password reset
- Password reset tokens single-use and expiring

## Secrets and data
- No credentials in code, config committed to the repo, logs or error messages
- Sensitive data encrypted at rest where required, never sent to the client unnecessarily
- Cryptography: standard libraries, no custom crypto, no ECB, no static IVs, secure random

## Web
- CSRF protection on state-changing requests with cookie auth
- CORS not reflecting arbitrary origins with credentials
- Cookies Secure, HttpOnly, SameSite
- Open redirects validated against an allowlist
- File uploads: type checked by content, size limited, stored outside web root, served with safe headers

## Operations
- Debug mode and verbose errors off in production
- TLS certificate verification never disabled
- Dependencies without known critical vulnerabilities in used code paths
