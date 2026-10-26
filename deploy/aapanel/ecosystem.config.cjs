module.exports = {
  apps: [{
    name: 'karim-erp',
    script: './backend/server.js',
    cwd: __dirname + '/../..',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '768M',
    time: true,
    out_file: './logs/pm2-out.log',
    error_file: './logs/pm2-error.log',
    merge_logs: true,
    env: {
      NODE_ENV: 'production',
    },
  }],
};
