# Burnin Dashboard - Complete Deployment Guide

**Target:** Fresh EC2 Instance (Amazon Linux 2023)
**Goal:** Production deployment with systemd services, PostgreSQL database, and pCloud sync

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Initial Server Setup](#initial-server-setup)
3. [Install System Dependencies](#install-system-dependencies)
4. [Build pcloudcc from Source](#build-pcloudcc-from-source)
5. [Configure pCloud Sync](#configure-pcloud-sync)
6. [Setup PostgreSQL Database](#setup-postgresql-database)
7. [Clone and Configure Application](#clone-and-configure-application)
8. [Restore Database from Dump](#restore-database-from-dump)
9. [Build Next.js Application](#build-nextjs-application)
10. [Setup Systemd Services](#setup-systemd-services)
11. [Configure Nginx Reverse Proxy](#configure-nginx-reverse-proxy)
12. [Security Hardening](#security-hardening)
13. [Monitoring and Maintenance](#monitoring-and-maintenance)

---

## Prerequisites

- Fresh EC2 instance (Amazon Linux 2023 recommended)
- SSH access with appropriate key
- Database dump file: `burnin_dashboard.dump`
- Azure AD OAuth credentials (Client ID, Secret, Tenant ID)
- pCloud account credentials

---

## Initial Server Setup

### 1. Connect to EC2 Instance

```bash
ssh -i your-key.pem ec2-user@your-instance-ip
```

### 2. Update System

```bash
sudo dnf update -y
```

### 3. Set Timezone (Optional)

```bash
sudo timedatectl set-timezone America/Los_Angeles
```

### 4. Create Application User

```bash
sudo useradd -m -s /bin/bash burnin
sudo usermod -aG wheel burnin  # Optional: if you need sudo access
```

---

## Install System Dependencies

### 1. Install Development Tools

```bash
sudo dnf groupinstall "Development Tools" -y
```

### 2. Install Required Packages

```bash
sudo dnf install -y \
    git \
    cmake \
    fuse \
    fuse-devel \
    zlib-devel \
    boost-devel \
    openssl-devel \
    postgresql15 \
    postgresql15-server \
    postgresql15-devel \
    nginx
```

### 3. Install Node.js via NVM

```bash
# As ec2-user or burnin user
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Load NVM
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Install Node.js 22.x
nvm install 22
nvm use 22
nvm alias default 22

# Verify installation
node --version  # Should show v22.x.x
npm --version
```

### 4. Add NVM to Shell Profile

```bash
cat >> ~/.bashrc << 'EOF'
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
EOF

source ~/.bashrc
```

---

## Build pcloudcc from Source

pCloud Console Client is required for syncing burn-in test data from pCloud storage.

### 1. Clone pcloudcc Repository

```bash
cd ~
git clone https://github.com/pcloudcom/console-client.git pcloudcc
cd pcloudcc
```

### 2. Build pcloudcc

```bash
# Create build directory
mkdir build && cd build

# Configure with cmake
cmake ..

# Compile (use -j to parallelize)
make -j$(nproc)
```

```bash
> sudo apt-get install cmake zlib1g-dev libboost-system-dev libboost-program-options-dev libpthread-stubs0-dev libfuse-dev libudev-dev fuse build-essential git
> mkdir console-client   
> git clone https://github.com/pcloudcom/console-client.git ./console-client/  
> cd ./console-client/pCloudCC/   
> cd lib/pclsync/        
> make clean    
> make fs     
> cd ../mbedtls/   
> cmake .      
> make clean     
> make       
> cd ../..      
> cmake .    
> make      
> sudo make install     
> sudo ldconfig     
> pcloudcc -u username -p    
```


### 3. Install pcloudcc

```bash
sudo make install

# Or install to custom location
sudo cp pcloudcc /usr/local/bin/
sudo chmod +x /usr/local/bin/pcloudcc
```

### 4. Verify Installation

```bash
pcloudcc --help
```

---

## Configure pCloud Sync

### 1. Create pCloud Mount Directory

```bash
sudo mkdir -p /mnt/pcloud
sudo chown burnin:burnin /mnt/pcloud
```

### 2. Start pcloudcc Daemon

```bash
# Start daemon as burnin user
sudo -u burnin pcloudcc -u your-email@domain.com -p -s
# You'll be prompted for your pCloud password
```

### 3. Mount pCloud Drive

```bash
# Start daemon in background
pcloudcc startcrypto YOUR_CRYPTO_PASS  # If using crypto folder
pcloudcc mount /mnt/pcloud
```

### 4. Create pCloud Systemd Service

Create `/etc/systemd/system/pcloud.service`:

```ini
[Unit]
Description=pCloud Console Client
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=burnin
Group=burnin
ExecStartPre=/bin/sleep 10
ExecStart=/usr/local/bin/pcloudcc -u your-email@domain.com -p -s -d /mnt/pcloud
Restart=always
RestartSec=10
Environment="HOME=/home/burnin"

[Install]
WantedBy=multi-user.target
```

**Note:** For automated startup, you'll need to configure passwordless authentication. See pCloud documentation for options (auth token, saved credentials, etc.).

### 5. Enable and Start pCloud Service

```bash
sudo systemctl daemon-reload
sudo systemctl enable pcloud.service
sudo systemctl start pcloud.service
sudo systemctl status pcloud.service
```

---

## Setup PostgreSQL Database

### 1. Initialize PostgreSQL

```bash
sudo postgresql-setup --initdb
```

### 2. Configure PostgreSQL Authentication

Edit `/var/lib/pgsql/data/pg_hba.conf`:

```bash
sudo nano /var/lib/pgsql/data/pg_hba.conf
```

Change the following lines from `ident` to `md5`:

```conf
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             all                                     md5
host    all             all             127.0.0.1/32            md5
host    all             all             ::1/128                 md5
```

### 3. Start and Enable PostgreSQL

```bash
sudo systemctl enable postgresql
sudo systemctl start postgresql
sudo systemctl status postgresql
```

### 4. Set PostgreSQL Password

```bash
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'your-secure-password';"
```

### 5. Create Database

```bash
sudo -u postgres createdb burnin_dashboard
```

---

## Clone and Configure Application

### 1. Clone Repository

```bash
# Clone as burnin user
sudo -u burnin git clone https://github.com/your-org/burnin.git /home/burnin/burnin
cd /home/burnin/burnin
sudo chown -R burnin:burnin /home/burnin/burnin
```

### 2. Create Data Directories

```bash
sudo -u burnin mkdir -p /home/burnin/burnin/data/{to_process,processed}/{tests,results}
sudo -u burnin mkdir -p /home/burnin/burnin/log
```

### 3. Create Configuration File

Copy and edit the config file:

```bash
sudo -u burnin cp config.template.json config.json
sudo -u burnin nano config.json
```

Update with your paths:

```json
{
  "paths": {
    "source_directories": [
      {
        "name": "BurnInTest",
        "results_dir": "/mnt/pcloud/BurnInTest/results",
        "data_dir": "/mnt/pcloud/BurnInTest/data"
      }
    ],
    "local": {
      "main_dir": "/home/burnin/burnin/data",
      "dashboard_dir": "/home/burnin/burnin",
      "log_dir": "/home/burnin/burnin/log"
    }
  },
  "settings": {
    "check_interval": 60,
    "cutoff_date": "2025-07-11",
    "log_file": "file_sync.log",
    "max_log_size_mb": 5,
    "log_backup_count": 5,
    "debug_firmware_version": "1.11.11",
    "timeout": {
      "cleanup": 120,
      "ingestion": 300
    }
  },
  "node": {
    "nvm_path": "~/.nvm/versions/node/v22.*/bin",
    "fallback_to_system": true
  },
  "database": {
    "host": "localhost",
    "port": 5432,
    "name": "burnin_dashboard",
    "user": "postgres",
    "password": "your-secure-password"
  },
  "api": {
    "base_url": "http://localhost:9001"
  }
}
```

### 4. Create Environment Variables

```bash
sudo -u burnin cp .env.example .env.local
sudo -u burnin nano .env.local
```

Update with production values:

```env
# NextAuth Configuration
NEXTAUTH_URL=https://your-domain.com
AUTH_TRUST_HOST=true
NEXTAUTH_SECRET=$(openssl rand -base64 32)

# Azure AD OAuth
AZURE_AD_CLIENT_ID=your-azure-client-id
AZURE_AD_CLIENT_SECRET=your-azure-client-secret
AZURE_AD_TENANT_ID=your-azure-tenant-id

# Access Control
ALLOWED_EMAIL_DOMAIN=@sparqsys.com

# Development Settings
SKIP_AUTH=false
```

### 5. Install Node Dependencies

```bash
cd /home/burnin/burnin
sudo -u burnin npm install --production=false
```

---

## Restore Database from Dump

### 1. Upload Database Dump

Transfer your `burnin_dashboard.dump` file to the server:

```bash
# From your local machine
scp -i your-key.pem burnin_dashboard.dump ec2-user@your-instance-ip:/tmp/
```

### 2. Restore Database

```bash
# Restore the dump
sudo -u postgres pg_restore -d burnin_dashboard -v /tmp/burnin_dashboard.dump

# Or if it's a SQL dump
sudo -u postgres psql -d burnin_dashboard -f /tmp/burnin_dashboard.dump
```

### 3. Verify Database Restoration

```bash
sudo -u postgres psql -d burnin_dashboard -c "\dt"
sudo -u postgres psql -d burnin_dashboard -c "SELECT COUNT(*) FROM Tests;"
sudo -u postgres psql -d burnin_dashboard -c "SELECT COUNT(*) FROM TestData;"
```

### 4. Run Additional Migrations (if needed)

```bash
cd /home/burnin/burnin
sudo -u burnin npm run migrate
sudo -u burnin npm run migrate:annotations
```

**Note:** Since you have a complete database dump, migrations may not be necessary unless there are schema changes in the new codebase.

---

## Build Next.js Application

### 1. Build Production Bundle

```bash
cd /home/burnin/burnin
sudo -u burnin npm run build
```

### 2. Verify Build

```bash
ls -la /home/burnin/burnin/.next
```

You should see the `.next` directory with compiled assets.

### 3. Test Application Locally

```bash
# Test start (Ctrl+C to stop after verification)
sudo -u burnin npm run start
```

Visit `http://your-instance-ip:9001` to verify it works.

---

## Setup Systemd Services

### 1. Create Next.js Service

Create `/etc/systemd/system/burnin-dashboard.service`:

```ini
[Unit]
Description=Burnin Dashboard - Next.js Application
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=burnin
Group=burnin
WorkingDirectory=/home/burnin/burnin
Environment="NODE_ENV=production"
Environment="PATH=/home/burnin/.nvm/versions/node/v22.14.0/bin:/usr/local/bin:/usr/bin:/bin"
Environment="NVM_DIR=/home/burnin/.nvm"
ExecStart=/home/burnin/.nvm/versions/node/v22.14.0/bin/npm start
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=burnin-dashboard

# Security Hardening
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/burnin/burnin/log /home/burnin/burnin/data
RestrictSUIDSGID=yes

[Install]
WantedBy=multi-user.target
```

**Important:** Update the Node.js path to match your actual version:

```bash
# Find your Node.js path
sudo -u burnin bash -c 'source ~/.nvm/nvm.sh && which node'
```

### 2. Create Watchdog Service

Create `/etc/systemd/system/burnin-watchdog.service`:

```ini
[Unit]
Description=Burnin Watchdog - File Sync and Ingestion Monitor
After=network-online.target pcloud.service postgresql.service burnin-dashboard.service
Wants=network-online.target
Requires=pcloud.service postgresql.service

[Service]
Type=simple
User=burnin
Group=burnin
WorkingDirectory=/home/burnin/burnin
Environment="PATH=/home/burnin/.nvm/versions/node/v22.14.0/bin:/usr/bin:/bin"
ExecStart=/usr/bin/python3 /home/burnin/burnin/scripts/watchdog.py
Restart=always
RestartSec=30
StandardOutput=journal
StandardError=journal
SyslogIdentifier=burnin-watchdog

# Security Hardening
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ReadWritePaths=/home/burnin/burnin/log /home/burnin/burnin/data /mnt/pcloud
RestrictSUIDSGID=yes

[Install]
WantedBy=multi-user.target
```

### 3. Enable and Start Services

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable services to start on boot
sudo systemctl enable burnin-dashboard.service
sudo systemctl enable burnin-watchdog.service

# Start services
sudo systemctl start burnin-dashboard.service
sudo systemctl start burnin-watchdog.service

# Check status
sudo systemctl status burnin-dashboard.service
sudo systemctl status burnin-watchdog.service
```

### 4. View Logs

```bash
# Dashboard logs
sudo journalctl -u burnin-dashboard.service -f

# Watchdog logs
sudo journalctl -u burnin-watchdog.service -f

# Combined logs
sudo journalctl -u burnin-dashboard.service -u burnin-watchdog.service -f
```

---

## Configure Nginx Reverse Proxy

### 1. Create Nginx Configuration

Create `/etc/nginx/conf.d/burnin-dashboard.conf`:

```nginx
upstream burnin_backend {
    server 127.0.0.1:9001;
    keepalive 32;
}

server {
    listen 80;
    server_name your-domain.com;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Request size limits
    client_max_body_size 10M;

    # Timeouts
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;

    location / {
        proxy_pass http://burnin_backend;
        proxy_http_version 1.1;

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Buffering
        proxy_buffering off;
        proxy_redirect off;
    }

    # Static file caching for Next.js
    location /_next/static {
        proxy_pass http://burnin_backend;
        proxy_cache_valid 200 60m;
        add_header Cache-Control "public, max-age=3600, immutable";
    }

    # Health check endpoint
    location /api/health {
        proxy_pass http://burnin_backend;
        access_log off;
    }

    # Logging
    access_log /var/log/nginx/burnin-access.log combined;
    error_log /var/log/nginx/burnin-error.log warn;
}
```

### 2. Test and Enable Nginx

```bash
# Test configuration
sudo nginx -t

# Enable and start Nginx
sudo systemctl enable nginx
sudo systemctl restart nginx
sudo systemctl status nginx
```

### 3. Configure Firewall (if using)

```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

### 4. Setup SSL with Let's Encrypt (Recommended)

```bash
# Install certbot
sudo dnf install certbot python3-certbot-nginx -y

# Obtain certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal is enabled by default
sudo systemctl status certbot-renew.timer
```

---

## Security Hardening

### 1. Configure Firewall Rules

```bash
# Only allow SSH, HTTP, HTTPS
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --remove-service=dhcpv6-client  # If not needed
sudo firewall-cmd --reload
```

### 2. Setup Automatic Security Updates

```bash
sudo dnf install dnf-automatic -y
sudo systemctl enable --now dnf-automatic.timer
```

### 3. Configure SELinux (if enabled)

```bash
# Check SELinux status
sestatus

# If enforcing, allow necessary permissions
sudo setsebool -P httpd_can_network_connect 1
sudo semanage port -a -t http_port_t -p tcp 9001
```

### 4. Restrict SSH Access

Edit `/etc/ssh/sshd_config`:

```bash
sudo nano /etc/ssh/sshd_config
```

Recommended settings:

```conf
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
X11Forwarding no
MaxAuthTries 3
```

Restart SSH:

```bash
sudo systemctl restart sshd
```

### 5. Setup Fail2Ban (Optional)

```bash
sudo dnf install fail2ban -y
sudo systemctl enable --now fail2ban
```

### 6. Enable AWS Systems Manager (if on AWS)

This allows secure access without SSH and automatic patching.

```bash
sudo dnf install amazon-ssm-agent -y
sudo systemctl enable amazon-ssm-agent
sudo systemctl start amazon-ssm-agent
```

---

## Monitoring and Maintenance

### 1. Setup Log Rotation

Create `/etc/logrotate.d/burnin-dashboard`:

```conf
/home/burnin/burnin/log/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0644 burnin burnin
    sharedscripts
    postrotate
        systemctl reload burnin-dashboard.service > /dev/null 2>&1 || true
    endscript
}
```

### 2. Monitor Services

Create a monitoring script `/home/burnin/check-services.sh`:

```bash
#!/bin/bash

services=("pcloud" "postgresql" "burnin-dashboard" "burnin-watchdog" "nginx")

for service in "${services[@]}"; do
    if ! systemctl is-active --quiet "$service"; then
        echo "WARNING: $service is not running"
        # Optional: send alert
    fi
done
```

Add to crontab:

```bash
sudo -u burnin crontab -e
```

Add:

```cron
*/5 * * * * /home/burnin/check-services.sh
```

### 3. Database Backup Script

Create `/home/burnin/backup-db.sh`:

```bash
#!/bin/bash

BACKUP_DIR="/home/burnin/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DB_NAME="burnin_dashboard"

mkdir -p $BACKUP_DIR

# Create backup
pg_dump -U postgres -F c -b -v -f "$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.dump" $DB_NAME

# Keep only last 7 days of backups
find $BACKUP_DIR -name "*.dump" -mtime +7 -delete

echo "Backup completed: ${DB_NAME}_${TIMESTAMP}.dump"
```

Make executable and add to crontab:

```bash
chmod +x /home/burnin/backup-db.sh
sudo -u burnin crontab -e
```

Add daily backup at 2 AM:

```cron
0 2 * * * /home/burnin/backup-db.sh >> /home/burnin/burnin/log/backup.log 2>&1
```

### 4. Monitor Disk Space

```bash
# Check current usage
df -h

# Set up alerts for low disk space
sudo dnf install logwatch -y
```

### 5. View Real-time Logs

```bash
# All services
sudo journalctl -f

# Specific service
sudo journalctl -u burnin-dashboard.service -f

# Last 100 lines
sudo journalctl -u burnin-dashboard.service -n 100

# Since specific time
sudo journalctl -u burnin-dashboard.service --since "2025-12-08 14:00"

# Filter by priority (err, warning, info)
sudo journalctl -u burnin-dashboard.service -p err
```

---

## Deployment Checklist

Use this checklist to verify your deployment:

### System Setup
- [ ] EC2 instance provisioned and accessible
- [ ] System packages updated
- [ ] Development tools installed
- [ ] PostgreSQL installed and running
- [ ] Nginx installed
- [ ] Node.js 22.x installed via NVM

### pCloud Setup
- [ ] pcloudcc built and installed
- [ ] pCloud mount directory created
- [ ] pCloud service configured and running
- [ ] Test data accessible in `/mnt/pcloud`

### Database Setup
- [ ] PostgreSQL initialized
- [ ] Database created: `burnin_dashboard`
- [ ] Database dump restored successfully
- [ ] Tables verified (Inverters, Tests, TestData, etc.)
- [ ] Migrations run (if needed)

### Application Setup
- [ ] Repository cloned to `/home/burnin/burnin`
- [ ] `config.json` created and configured
- [ ] `.env.local` created with production values
- [ ] `NEXTAUTH_SECRET` generated
- [ ] Azure AD credentials configured
- [ ] Node dependencies installed
- [ ] Production build completed (`npm run build`)
- [ ] Data directories created

### Systemd Services
- [ ] `burnin-dashboard.service` created and enabled
- [ ] `burnin-watchdog.service` created and enabled
- [ ] `pcloud.service` created and enabled
- [ ] All services running without errors
- [ ] Services restart automatically after reboot

### Nginx & SSL
- [ ] Nginx configuration created
- [ ] Nginx running and proxying to port 9001
- [ ] SSL certificate installed (Let's Encrypt)
- [ ] HTTPS working correctly
- [ ] HTTP redirects to HTTPS

### Security
- [ ] Firewall configured (only SSH, HTTP, HTTPS)
- [ ] SSH hardened (no root, no password auth)
- [ ] Automatic security updates enabled
- [ ] SELinux configured (if applicable)
- [ ] Log rotation configured
- [ ] Systemd security options applied

### Monitoring & Backups
- [ ] Service monitoring script created
- [ ] Database backup script created and scheduled
- [ ] Log monitoring setup
- [ ] Disk space monitoring configured

### Testing
- [ ] Application accessible via HTTPS
- [ ] Authentication works (Azure AD OAuth)
- [ ] Dashboard loads test data
- [ ] Charts render correctly
- [ ] Annotations can be created/edited
- [ ] Watchdog syncing and ingesting new files
- [ ] All API endpoints responding

---

## Troubleshooting

### Service Won't Start

```bash
# Check service status
sudo systemctl status burnin-dashboard.service

# View detailed logs
sudo journalctl -u burnin-dashboard.service -n 100 --no-pager

# Check if port is already in use
sudo lsof -i :9001

# Verify Node.js path
sudo -u burnin bash -c 'source ~/.nvm/nvm.sh && which node'
```

### Database Connection Issues

```bash
# Test database connection
sudo -u postgres psql -d burnin_dashboard -c "SELECT 1;"

# Check PostgreSQL is listening
sudo ss -tlnp | grep 5432

# Verify credentials in config.json
cat /home/burnin/burnin/config.json | grep -A 5 database
```

### pCloud Not Mounting

```bash
# Check pCloud service
sudo systemctl status pcloud.service

# Check mount point
ls -la /mnt/pcloud

# Manually test pcloudcc
sudo -u burnin pcloudcc --help
```

### Build Failures

```bash
# Clear Next.js cache
sudo -u burnin rm -rf /home/burnin/burnin/.next

# Reinstall dependencies
cd /home/burnin/burnin
sudo -u burnin rm -rf node_modules package-lock.json
sudo -u burnin npm install

# Rebuild
sudo -u burnin npm run build
```

### Permission Issues

```bash
# Fix ownership
sudo chown -R burnin:burnin /home/burnin/burnin

# Fix data directory permissions
sudo chmod -R 755 /home/burnin/burnin/data
sudo chmod -R 755 /home/burnin/burnin/log
```

---

## Additional Resources

- **Next.js Documentation:** https://nextjs.org/docs
- **PostgreSQL Documentation:** https://www.postgresql.org/docs/
- **pCloud Console Client:** https://github.com/pcloudcom/console-client
- **NextAuth.js Documentation:** https://next-auth.js.org/
- **systemd Documentation:** https://www.freedesktop.org/software/systemd/man/

---

## Support

For issues specific to this deployment, check:

1. Application logs: `sudo journalctl -u burnin-dashboard.service -f`
2. Watchdog logs: `sudo journalctl -u burnin-watchdog.service -f`
3. Nginx logs: `sudo tail -f /var/log/nginx/burnin-error.log`
4. PostgreSQL logs: `sudo tail -f /var/lib/pgsql/data/log/postgresql-*.log`

---

**Deployment Guide Version:** 1.0
**Last Updated:** December 8, 2025
**Tested On:** Amazon Linux 2023, Ubuntu 22.04 LTS
