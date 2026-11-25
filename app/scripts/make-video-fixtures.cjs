// Fixtures for the video indexer tests in core/crates/media.
// Rerun only when the expected segment counts change.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const winRoot = path.join(__dirname, '..');
const vendored = path.join(winRoot, 'vendor', 'ffmpeg', 'ffmpeg.exe');
const ffmpeg = process.argv[2] || (fs.existsSync(vendored) ? vendored : 'ffmpeg');
const outDir = path.join(__dirname, '..', '..', 'shared', 'fixtures', 'video');
fs.mkdirSync(outDir, { recursive: true });

const out = (name) => path.join(outDir, name);
const enc = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '35', '-preset', 'veryslow'];
const run = (args) => execFileSync(ffmpeg, ['-y', ...args], { stdio: 'ignore', windowsHide: true });

run(['-f', 'lavfi', '-i', 'color=c=gray:s=160x90:r=10:d=10', ...enc, '-an', out('still.mp4')]);

run([
  '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=10:d=5',
  '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10:d=5',
  '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]',
  ...enc, '-an', out('two-scenes.mp4'),
]);

run([
  '-f', 'lavfi', '-i', 'color=c=gray:s=160x90:r=10:d=8',
  '-f', 'lavfi', '-i', 'color=c=white:s=12x12:r=10:d=8',
  // overlay knows t as time; drawbox reads t as thickness.
  '-filter_complex', "[0:v][1:v]overlay=x='if(lt(t,3),20,if(lt(t,5),20+(t-3)*50,120))':y=40[v]", '-map', '[v]',
  ...enc, '-an', out('cursor.mp4'),
]);

run(['-f', 'lavfi', '-i', 'testsrc=s=160x90:r=10:d=5', ...enc, '-an', out('testsrc.mp4')]);

// Portrait: encode, then rewrap with display rotation (copy, no re-encode).
const portraitSrc = out('portrait-src.mp4');
run(['-f', 'lavfi', '-i', 'testsrc=s=160x90:r=10:d=2', ...enc, '-an', portraitSrc]);
try {
  run(['-display_rotation', '90', '-i', portraitSrc, '-c', 'copy', out('portrait.mov')]);
} catch (err) {
  console.warn('-display_rotation rejected, falling back to rotate metadata');
  run(['-i', portraitSrc, '-c', 'copy', '-metadata:s:v:0', 'rotate=90', out('portrait.mov')]);
}
fs.unlinkSync(portraitSrc);

run([
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
  '-c:a', 'aac', '-b:a', '32k', out('no-video.m4a'),
]);

console.log(`fixtures written to ${outDir}`);
