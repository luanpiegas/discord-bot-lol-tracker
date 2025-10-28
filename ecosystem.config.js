module.exports = {
  apps: [
    {
      name: 'banhos-poderosos-bot',
      script: 'main.js',
      node_args: '--env-file=.env',
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
      },
      env_development: {
        NODE_ENV: 'development'
      },
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      merge_logs: true,
      time: true,
      max_memory_restart: '300M'
    }
  ]
};


