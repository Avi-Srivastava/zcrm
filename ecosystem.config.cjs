module.exports = {
  apps: [
    {
      name: 'crm-sync',
      script: 'src/index.js',
      cwd: '/home/user/my-app',
      watch: false,
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'auto-pull',
      script: 'start-with-autopull.sh',
      cwd: '/home/user/my-app',
      interpreter: '/bin/bash',
      watch: false
    }
  ]
};
