---
title: Connectivity
description: Connect a BySpace client to your daemon through SSH, the relay, or Tailscale.
nav: Connectivity
order: 4
category: Getting started
---

# Connectivity

Your BySpace app connects to the daemon running on your computer or server. BySpace Desktop and the CLI can tunnel through SSH. Mobile clients can connect through the BySpace relay or directly with Tailscale.

This is client-to-daemon transport. If you are looking for the upstream service that starts agents from GitHub, Slack, and Discord events, that is [Paseo Hub](/docs/hub).

- [SSH](#ssh)
- [BySpace relay](#byspace-relay)
- [Tailscale](#tailscale)

## SSH

SSH transport connects to an existing daemon through your local OpenSSH client. It does not install, start, or configure BySpace on the remote host.

Before connecting:

1. Start the BySpace daemon on the remote host.
2. Confirm `ssh user@host` works with a key or SSH agent. BySpace uses non-interactive SSH and follows your OpenSSH config. If the host only supports password authentication, enter the password in the Remote SSH dialog instead — connections with a password use a built-in SSH client.
3. On the first connection BySpace shows the host's key fingerprint and asks you to trust it; later connections verify against that choice. A changed fingerprint triggers an explicit warning before anything is sent to the host.

The CLI accepts an SSH URI as its host (key or agent authentication only; confirm the host key once in a terminal):

```bash
byspace ls -a --host ssh://user@host
```

The daemon is expected at `127.0.0.1:6777` on the remote host. The port in the SSH URL is the SSH server port:

```bash
byspace ls -a --host ssh://user@host:2222
```

Set a different remote daemon port with `daemonPort`:

```bash
byspace ls -a --host 'ssh://user@host?daemonPort=7777'
```

`--host` belongs after the command. `byspace daemon status` checks only the local daemon; use `byspace ls --host ...` to verify a remote connection. `byspace run --host ...` also requires `--cwd` with a path that exists on the remote host.

In BySpace Desktop, open **Settings → Add host → Remote SSH** and enter the same destination. The `ssh://` prefix is optional: `user@host`, `user@host:2222`, and full `ssh://` URIs all work. The password field is optional; leave it empty to authenticate with your keys or SSH agent. Desktop connections prompt for the host key fingerprint on first use and warn if it ever changes.

## BySpace relay

The relay works without Tailscale, port forwarding, or network configuration. Traffic is end-to-end encrypted.

Relay is disabled until you enable it.

### Enable relay from BySpace Desktop

1. Open **Settings → your host → Pair a device**.
2. Select **Enable relay**.
3. Scan the QR code with BySpace on your phone, or copy the pairing link and paste it into the phone app.

### Enable relay from the CLI

Run:

```bash
byspace daemon pair
```

Confirm when prompted. BySpace prints a QR code and pairing link. Scan the QR code with BySpace on your phone, or choose **Paste pairing link** in the phone app.

## Tailscale

Install [Tailscale](https://tailscale.com/download) on the daemon machine and your phone. Sign in to the same tailnet on both devices.

### 1. Find the daemon machine's Tailscale IP

Run this on the daemon machine:

```bash
tailscale ip -4
```

Copy the address it prints. The example below uses `100.101.102.103`.

### 2. Configure the daemon

Open `~/.byspace/config.json` and set `daemon.listen` to the Tailscale IP:

```json
{
  "$schema": "https://paseo.sh/schemas/paseo.config.v1.json",
  "version": 1,
  "daemon": {
    "listen": "100.101.102.103:6777"
  }
}
```

Keep the other settings already in the file. If it has a `daemon` object, add `listen` inside that object.

To restrict access with a password, see [Password authentication](/docs/configuration#password-authentication).

Restart the daemon:

```bash
byspace daemon restart
```

If BySpace Desktop manages the daemon, use **Settings → your host → Overview → Restart daemon**.

### 3. Connect the phone app

1. Connect Tailscale on your phone.
2. Open BySpace and go to **Settings → Add host → Direct connection**.
3. Enter the Tailscale IP in **Host**.
4. Enter `6777` in **Port**.
5. Leave **Use SSL** off and select **Connect**.

If the host was already paired through the relay, BySpace adds the direct connection to the same host.

## Troubleshooting

- **SSH authentication failed:** Run `ssh user@host` in a terminal and fix the key, agent, host key, or `~/.ssh/config` entry there. BySpace does not prompt for SSH passwords.
- **SSH connects but BySpace is refused:** Run `byspace daemon status` on the remote host. SSH transport does not start the daemon.
- **Connection timed out:** Check that Tailscale is connected on both devices and that you used the daemon machine's Tailscale IP.
- **Connection refused:** Run `byspace daemon status` and confirm the daemon is running on the configured IP and port.
- **Config change has no effect:** Run `byspace reload`. `daemon.listen` is a startup setting, so restart when the command reports it.
