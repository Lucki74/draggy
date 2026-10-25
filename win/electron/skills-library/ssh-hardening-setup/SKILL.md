---
name: ssh-hardening-setup
description: Sets up SSH key authentication and hardens sshd and client config step by step, keeping a second session open so the user cannot be locked out, and tests each change before the next. Use when the user asks to set up SSH keys, disable password logins, or secure SSH on a server.
---

# SSH setup and hardening

## Goal

Move a server to key only login with no root password access, and leave a tested way back in.

A good procedure changes one thing at a time and verifies from a second terminal.

## When to use

- A new server needs secure access.
- Password login or root login is still on.
- The user wants a client config for several hosts.
- For firewall and web exposure, use `use_skill` with `nginx-config` for proxy rules.

## Steps

1. Ask with `ask_user` for the host, the OS, the current login method and whether there is console access from the provider. Console access is the safety net.
2. On the user's machine, check for an existing key with `list_directory` on `~/.ssh`. Prefer ed25519; create one with `ssh-keygen` through `run_command` only if none exists and the user agrees. Use a passphrase.
3. Install the public key on the server with `ssh-copy-id` or append it to `authorized_keys`, with correct permissions: directory 700, file 600, owned by the user.
4. Test key login in a new terminal. Do not close the original session.
5. Create a non-root user with sudo for admin work if one does not exist, and test sudo.
6. Edit `/etc/ssh/sshd_config` or a drop-in under `sshd_config.d`. Set `PasswordAuthentication no`, `PermitRootLogin no` (or `prohibit-password`), and limit users with `AllowUsers`.
7. Check for included files that override your setting, since the first value wins in many versions. Show effective values with `sshd -T` through `run_command`.
8. Validate with `sshd -t` before reload, then reload the service and test a fresh login in a third terminal while the old one stays open.
9. Optionally change limits: `MaxAuthTries`, idle timeouts, and disabling unused features such as X11 forwarding. Note that moving the port is minor obscurity, not protection.
10. Add fail2ban or equivalent and a host firewall that allows the SSH port, after checking the rules will not cut the current session.
11. Write a client `~/.ssh/config` entry with host alias, user, key and `IdentitiesOnly yes`.
12. Record the recovery path: provider console, and where the backup key is kept.

## Gotchas

- Reloading sshd with a typo or with password login off before the key works locks the user out. Always test in a second session.
- Wrong permissions on `~/.ssh` or the home directory make sshd silently ignore the key.
- Cloud images often ship a drop-in file that re-enables password login after your edit. Check `sshd -T`.
- Disabling root login before a sudo user is tested leaves no way to administer the host.
- A key without a passphrase on a laptop is a login for anyone who gets the laptop.
- Never paste a private key into chat. Only the `.pub` file is shared.

## Output

- The settings changed and effective values from `sshd -T`.
- Test evidence for each stage (key login, sudo, fresh session after reload).
- The recovery path, and anything left for the user to do themselves.
