const fs = require('fs');
const path = require('path');
const { createBackup } = require('./backup');

// Where scheduled backups land. Defaults next to the DB file so it rides
// along in the existing `db-data` volume out of the box, but operators can
// point BACKUP_DIR at a separately-mounted volume/bind-mount for real
// off-box protection (a volume-level disaster takes both the DB and a
// same-volume backup down together).
function backupDir() {
  return process.env.BACKUP_DIR || path.join(path.dirname(process.env.DB_PATH || path.join(__dirname, '../../data/openflow.db')), 'backups');
}

function writeScheduledBackup(db) {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const backup = createBackup(db);
  const filename = `openflow-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(backup));
  return filename;
}

function pruneOldBackups(retentionCount) {
  const dir = backupDir();
  let files;
  try {
    files = fs.readdirSync(dir).filter(f => f.startsWith('openflow-backup-') && f.endsWith('.json'));
  } catch {
    return;
  }
  files.sort();
  const excess = files.length - retentionCount;
  for (let i = 0; i < excess; i++) {
    fs.unlinkSync(path.join(dir, files[i]));
  }
}

function listScheduledBackups() {
  const dir = backupDir();
  let files;
  try {
    files = fs.readdirSync(dir).filter(f => f.startsWith('openflow-backup-') && f.endsWith('.json'));
  } catch {
    return [];
  }
  return files
    .map(filename => {
      const stat = fs.statSync(path.join(dir, filename));
      return { filename, size: stat.size, created_at: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// Filename must come from listScheduledBackups (or match its exact format)
// before being used to build a filesystem path, so a caller can't traverse
// out of the backups directory.
function isValidBackupFilename(filename) {
  return /^openflow-backup-[\w.-]+\.json$/.test(filename) && !filename.includes('..');
}

function readScheduledBackup(filename) {
  if (!isValidBackupFilename(filename)) throw new Error('Invalid backup filename');
  return fs.readFileSync(path.join(backupDir(), filename));
}

function startBackupScheduler(db) {
  if (process.env.BACKUP_ENABLED === 'false') {
    console.log('Scheduled backups disabled (BACKUP_ENABLED=false)');
    return null;
  }
  const intervalHours = Number(process.env.BACKUP_INTERVAL_HOURS) > 0 ? Number(process.env.BACKUP_INTERVAL_HOURS) : 24;
  const retentionCount = Number(process.env.BACKUP_RETENTION_COUNT) > 0 ? Number(process.env.BACKUP_RETENTION_COUNT) : 14;

  const run = () => {
    try {
      const filename = writeScheduledBackup(db);
      pruneOldBackups(retentionCount);
      console.log(`Scheduled backup written: ${filename}`);
    } catch (err) {
      console.error('Scheduled backup failed:', err.message);
    }
  };

  run();
  const timer = setInterval(run, intervalHours * 60 * 60 * 1000);
  timer.unref();
  console.log(`Scheduled backups enabled: every ${intervalHours}h, keeping last ${retentionCount}, dir=${backupDir()}`);
  return timer;
}

module.exports = { startBackupScheduler, listScheduledBackups, readScheduledBackup, backupDir };
