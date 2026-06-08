# 🚀 Orbit (Cloud Edition)

An automated Microsoft Rewards farming bot, fully modernized to run 24/7 in the cloud. Earn points across multiple accounts completely hands-free using GitHub Actions and Neon Postgres.

<p align="center">
  <img src="https://github.com/AnujYadav-Dev/Orbit-Beta/blob/main/assets/logo.png" alt="Logo" />
</p>

> This is a fork of the [QuestPilot Microsoft-Rewards-Bot](https://github.com/QuestPilot/Microsoft-Rewards-Bot). It has been heavily modified to strip out Docker, Nix, and proprietary auto-updaters, in favor of a robust, standard cloud-native stack.

---

## 🏗️ Architecture

The bot runs entirely in the cloud, utilizing free-tier services:

1. **GitHub Actions**: Runs the bot on a daily cron schedule (no servers to manage).
2. **Neon Postgres**: Stores session cookies, fingerprints, and bot logs (keeps your accounts logged in between runs).
3. **Render Dashboard**: A beautiful, standalone dashboard to monitor your bot runs, view logs, and check points from any browser.

---

## 🛠️ Setup Instructions

### 1. Database Setup (Neon)

1. Go to [neon.tech](https://neon.tech) and create a free PostgreSQL database.
2. Copy your connection string (it looks like `postgresql://user:password@endpoint.region.aws.neon.tech/neondb?sslmode=require`).
3. _Note: You do not need to create any tables. The bot will automatically create the required `sessions` and `run_logs` tables on its first run._

### 2. GitHub Secrets

Go to your repository settings on GitHub (`Settings` -> `Secrets and variables` -> `Actions`) and add the following **Repository Secrets**:

| Secret Name     | Description                                     |
| --------------- | ----------------------------------------------- |
| `DATABASE_URL`  | Your Neon Postgres connection string.           |
| `ACCOUNTS_JSON` | The full contents of your `accounts.json` file. |
| `CONFIG_JSON`   | The full contents of your `config.json` file.   |

> **Region Setting**: Orbit currently works properly only for the Indian region. The default geo locale is India, represented as `"in"`. You can override it per account in `accounts.json` by setting `"geoLocale"` to `"in"` or another two-letter country code. `"auto"` is still accepted, but the bot falls back to India when it cannot determine a country automatically.

> **Important Config Setting**: In your `CONFIG_JSON`, make sure to disable the internal scheduler and set headless to true:
>
> ```json
> "headless": true,
> "clusters": 1,
> "scheduler": { "enabled": false },
> "safetyAdvisory": { "blockedBehavior": "continue" }
> ```

### 3. Deploy the Dashboard (Render)

To view your logs and stats, deploy the standalone dashboard:

1. Go to [render.com](https://render.com) and create a new **Web Service**.
2. Connect your GitHub repository.
3. Set **Root Directory** to `dashboard-server`.
4. Set **Build Command** to `npm install`.
5. Set **Start Command** to `npm start`.
6. Add two environment variables:
    - `DATABASE_URL`: Your Neon Postgres connection string.
    - `ACCESS_TOKEN`: A secret password of your choice (used to log into the dashboard).
7. Deploy! Your dashboard is now live.

---

## 🚀 Running the Bot

### Cloud Mode (GitHub Actions)

The bot is pre-configured to run automatically every day at 12:15 PM UTC.
To run it manually:

1. Go to the **Actions** tab in your GitHub repository.
2. Select **"Orbit - Scheduled Run"**.
3. Click **"Run workflow"**.

### Local Mode (Development)

You can still run the bot locally on your machine. If `DATABASE_URL` is not set in your environment, the bot will automatically fall back to reading from local `accounts.json` / `config.json` files and saving sessions to the local `sessions/` folder.

```bash
# Install dependencies
npm install

# Run the bot
npm start
```

---

## 📝 Features & Enhancements in this Fork

- **Serverless Ready:** Fully decoupled from the filesystem. State is stored in Postgres.
- **Lightweight:** Removed the 11MB Windows installer, Docker configurations, and Nix environments.
- **Standalone Dashboard:** Replaced the proprietary desktop dashboard with a beautiful, responsive web dashboard built on Express and HTML/CSS.
- **Auto-Releases:** Pushing a version bump to the `main` branch automatically generates a GitHub Release.
- **Unmodified Core Logic:** All the underlying automation, proxy support, and anti-detect features of the original bot are completely intact and untouched.

---

## 📄 License

This project retains the upstream PolyForm Noncommercial License. See the [LICENSE](LICENSE) file for details.

---

<div align="center">

#### ⚠️ Disclaimer

<sub>**Legal Notice:** This project is independent and is not affiliated with, authorized, maintained, sponsored, or endorsed by Microsoft Corporation or any of its affiliates or subsidiaries.</sub>

<sub>**Risk Warning:** The use of automated scripts, bots, or tools to interact with Microsoft Rewards may violate Microsoft's Services Agreement and Terms of Service. Utilizing this software could result in account suspension, restriction, or permanent banning. **Use entirely at your own risk.**</sub>

</div>
