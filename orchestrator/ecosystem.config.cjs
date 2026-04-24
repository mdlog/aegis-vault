// PM2 process manifest — alternative to Docker for bare-metal hosts.
//
// Start:   pm2 start ecosystem.config.cjs
// Reload:  pm2 reload aegis-orchestrator
// Logs:    pm2 logs aegis-orchestrator
//
// Env vars come from the machine's environment (or an adjacent .env file if
// dotenv is loaded by src/index.js before this manifest is read). Do NOT bake
// secrets into this file.

module.exports = {
  apps: [
    {
      name: 'aegis-orchestrator',
      script: 'src/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      // Let node-cron schedule cycles in-process. Restarts are automatic on
      // crash (max 10 in 60s before PM2 gives up — tune if your upstream
      // is flaky).
      autorestart: true,
      max_restarts: 10,
      min_uptime: '60s',
      kill_timeout: 10_000,
      watch: false,
      max_memory_restart: '800M',
      env: {
        NODE_ENV: 'production',
        PORT: 4002,
      },
      // Separate files per stream so log shippers can tail selectively.
      out_file: './logs/orchestrator-out.log',
      error_file: './logs/orchestrator-err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
