# Playing online

Glockenfels online is one small Node server (`apps/server`) that serves the game and runs every online match. Browsers connect to it over a single WebSocket.

## How it works

- **Accounts.** Pick a username and a passcode (4+ characters). No email. The browser keeps a sign-in token, so you stay signed in; the passcode is only for signing in on another device. Passcodes are hashed (scrypt), but this is deliberately light security for friends, not a public service.
- **Rooms.** "Host a game" makes a room with a 5-letter code and an invite link (`…/?join=CODE`). On iPhone the Share button opens the share sheet; on Mac it copies the link. The host adds bots, removes seats, and picks the rules with the same builder as pass and play (presets, modules, rules, tile counts, scoring). Up to 8 seats.
- **Friends.** Add someone by username; they accept. Online friends show a green dot, and from a lobby you can invite them with one tap (they get a banner with a Join button). Friends sitting in an open lobby show a Join button on your home screen.
- **Secret rule draft.** Each person picks their rule on their own device. Picks stay hidden until all are in, clashes go to the host, and the server plays three quick bot games to prove the mix can finish before the game starts.
- **The server is the referee.** It holds the only real game. Every move is checked by the same engine as pass and play (`apply` rejects anything illegal, out of turn, or based on an old board), bots play on the server, and each player gets a copy of the state with hidden information stripped: the deck order, the random seed and other players' action tiles.
- **Dropping out.** Phones reconnect by themselves and you get your seat back. If someone is gone for 30 seconds on their turn, the others can let a bot play for them until they return. Resigning hands your seat to a bot for the rest of the game and ranks you last.
- **Restarts.** Every move is written to SQLite as it happens, so a server restart (or a redeploy) picks every running game back up.
- **Elo.** Everyone starts at 1200. A game is rated when at least two different people play; bots never count. Each pair of people at the table is scored as a head-to-head (higher score wins the pair, equal scores split it) and the changes are scaled by K = 32 / (people − 1), so two-player games behave exactly like classic Elo and an 8-player game doesn't swing harder. Resigned players rank last.
- **History and leaderboard.** "My games" lists finished games with places, scores and rating changes, and each one can be replayed move by move. The leaderboard ranks everyone who has finished a game.

## Run it on your Mac

```sh
npm install
npm run online        # builds the game and starts the server on http://localhost:8787
```

Open http://localhost:8787 and tap **Play online**. A phone on the same Wi-Fi can use your Mac's address, e.g. `http://192.168.1.20:8787` (System Settings → Wi-Fi → Details shows it).

While working on the client, run `npm run dev:server` and `npm run dev` side by side; the Vite dev server passes `/ws` through to the game server.

## Play with a friend tonight (no hosting yet)

Keep `npm run online` running and open a free Cloudflare quick tunnel in a second terminal:

```sh
brew install cloudflared
cloudflared tunnel --url http://localhost:8787
```

It prints an `https://….trycloudflare.com` address that works from anywhere, including your friend's iPhone. Share that address (or an invite link from a lobby). It only lasts while your Mac is awake and the command is running, and the address changes each time.

## Hosting recommendation

**Fly.io, one always-on `shared-cpu-1x` machine with 512 MB and a 1 GB volume.** Expect a few dollars a month (check Fly's current pricing page). Why this one:

- The whole game is one process plus one SQLite file, so it needs exactly one small always-on machine and a disk, which is what this is.
- Deploying is `fly deploy` from this repo using the `Dockerfile` and `fly.toml` already here. HTTPS, WebSockets and a `*.fly.dev` address come built in; there's no server to patch.
- It must stay on (no scale-to-zero): live games and open sockets sit in memory between moves.

Steps, once you have a Fly account and `brew install flyctl`:

```sh
fly auth login
# edit fly.toml: set app to a unique name and primary_region to one near you
fly launch --copy-config --no-deploy
fly volumes create data --size 1
fly deploy
```

Then open `https://<app>.fly.dev`. Back up the database any time with `fly ssh sftp get /data/glockenfels.db`.

Alternatives if Fly doesn't suit: a Hetzner or DigitalOcean VPS (about the same price, but you look after the machine and HTTPS yourself), or Railway/Render with a persistent disk (similar ease, usually a bit more per month). Avoid free tiers that sleep: a sleeping server drops everyone's game.

## Limits for now

- Light security by design: no email, no password reset (a forgotten passcode means a new account), no rate limiting, and the drawn tile and hands are as visible as at a real table.
- No asynchronous play: a game runs while people have it open (the server keeps it if everyone leaves, and you can come back to it).
- One server process. That comfortably covers friends-and-family numbers; it isn't built to scale out.
