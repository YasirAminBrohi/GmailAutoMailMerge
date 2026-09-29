/**
 * Gmail AutoMail Merge - Zero-Dependency Build Script
 * Packages the Chrome Manifest V3 Extension into a production-ready
 * distribution directory (dist/extension) and a deployable zip archive (dist/gmail-automail-merge-v<version>.zip).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = __dirname;
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const STAGING_DIR = path.join(DIST_DIR, 'extension');

console.log('🚀 Building Gmail AutoMail Merge Extension...\n');

// 1. Read & Validate manifest.json
const manifestPath = path.join(ROOT_DIR, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('❌ Error: manifest.json not found in workspace root.');
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log(`✅ Validated manifest.json (v${manifest.version})`);
} catch (err) {
  console.error('❌ Error: Failed to parse manifest.json as JSON:', err.message);
  process.exit(1);
}

// 2. Syntax Check JavaScript Files
const jsFiles = ['background.js', 'content.js', 'worker.js'];
for (const file of jsFiles) {
  const filePath = path.join(ROOT_DIR, file);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Error: Required file missing: ${file}`);
    process.exit(1);
  }
  try {
    execSync(`node --check "${filePath}"`, { stdio: 'pipe' });
    console.log(`✅ Syntax check passed: ${file}`);
  } catch (err) {
    console.error(`❌ Syntax error in ${file}:\n${err.stderr.toString()}`);
    process.exit(1);
  }
}

// 3. Prepare Staging & Distribution Directories
if (fs.existsSync(DIST_DIR)) {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(STAGING_DIR, { recursive: true });

// 4. Copy Production Files
const filesToCopy = [
  'manifest.json',
  'background.js',
  'content.js',
  'styles.css',
  'worker.js',
  'icon128.png',
  'northpeak-logo.svg'
];

for (const file of filesToCopy) {
  const src = path.join(ROOT_DIR, file);
  const dest = path.join(STAGING_DIR, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  } else {
    console.warn(`⚠️ Warning: Expected file not found: ${file}`);
  }
}

// Copy icons directory if it exists
const iconsSrcDir = path.join(ROOT_DIR, 'icons');
const iconsDestDir = path.join(STAGING_DIR, 'icons');
if (fs.existsSync(iconsSrcDir)) {
  fs.mkdirSync(iconsDestDir, { recursive: true });
  const iconFiles = fs.readdirSync(iconsSrcDir);
  for (const icon of iconFiles) {
    fs.copyFileSync(path.join(iconsSrcDir, icon), path.join(iconsDestDir, icon));
  }
}

console.log('✅ Staged all production assets in dist/extension/');

// 5. Create Distribution Zip Archive
const zipFileName = `gmail-automail-merge-v${manifest.version}.zip`;
const zipFilePath = path.join(DIST_DIR, zipFileName);

try {
  // Use PowerShell .NET ZipArchive to build standard POSIX-compliant zip with forward slashes
  const psScript = `
    Add-Type -AssemblyName System.IO.Compression;
    Add-Type -AssemblyName System.IO.Compression.FileSystem;
    $src = '${STAGING_DIR.replace(/'/g, "''")}';
    $zip = '${zipFilePath.replace(/'/g, "''")}';
    if (Test-Path $zip) { Remove-Item $zip };
    $stream = [System.IO.File]::Create($zip);
    $archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create);
    Get-ChildItem -Path $src -Recurse -File | ForEach-Object {
      $relPath = $_.FullName.Substring($src.Length + 1).Replace('\\', '/');
      $entry = $archive.CreateEntry($relPath, [System.IO.Compression.CompressionLevel]::Optimal);
      $eStream = $entry.Open();
      $fStream = [System.IO.File]::OpenRead($_.FullName);
      $fStream.CopyTo($eStream);
      $fStream.Dispose();
      $eStream.Dispose();
    };
    $archive.Dispose();
    $stream.Dispose();
  `.replace(/\r?\n\s*/g, ' ');

  execSync(`powershell -NoProfile -Command "${psScript}"`, { stdio: 'pipe' });

  const zipStats = fs.statSync(zipFilePath);
  const zipSizeKb = (zipStats.size / 1024).toFixed(2);
  console.log(`\n📦 Successfully created release package:`);
  console.log(`   Artifact: dist/${zipFileName} (${zipSizeKb} KB)`);
  console.log(`   Unpacked: dist/extension/`);
  console.log('\n🎉 Extension built successfully!\n');
  console.log('📋 Installation options:');
  console.log('   1. Developer Mode: Go to chrome://extensions, enable "Developer mode", click "Load unpacked", and select:');
  console.log(`      ${STAGING_DIR}`);
  console.log('   2. Distribution / Chrome Web Store: Upload the ZIP archive:');
  console.log(`      ${zipFilePath}\n`);
} catch (err) {
  console.error('❌ Error creating zip archive:', err.message);
  process.exit(1);
}
