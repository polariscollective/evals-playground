import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import {
  openUploadLink,
  sealUploadLink,
  UPLOAD_LINK_TTL_MS,
  uploadedText,
} from "./import-upload-link.ts";

const SECRET = "a secret long enough to stand for AUTH_SECRET";
const NOW = Date.parse("2026-10-13T12:00:00Z");
const LINK = {
  draftId: "05b5cf8b-bded-4b1c-b17a-152e49c4b3d9",
  caller: "sam@polariscollective.org",
  launchedAt: null,
};

test("a sealed link opens to what was sealed, with its expiry", () => {
  const token = sealUploadLink(LINK, SECRET, NOW);
  assert.deepEqual(openUploadLink(token, SECRET, NOW + 1000), {
    ...LINK,
    expiresAt: NOW + UPLOAD_LINK_TTL_MS,
  });
});

test("the token travels in a path: base64url only", () => {
  assert.match(sealUploadLink(LINK, SECRET, NOW), /^[A-Za-z0-9_-]+$/);
});

test("the caller's address cannot be read off the link", () => {
  const token = sealUploadLink(LINK, SECRET, NOW);
  const decoded = Buffer.from(token, "base64url").toString("latin1");
  assert.ok(!decoded.includes("polariscollective"));
  assert.ok(!decoded.includes(LINK.draftId));
});

test("an expired link does not open", () => {
  const token = sealUploadLink(LINK, SECRET, NOW);
  assert.equal(openUploadLink(token, SECRET, NOW + UPLOAD_LINK_TTL_MS + 1), "expired");
});

test("a link sealed with another secret does not open", () => {
  const token = sealUploadLink(LINK, "another secret entirely", NOW);
  assert.equal(openUploadLink(token, SECRET, NOW), "invalid");
});

test("a link altered by one character does not open", () => {
  const token = sealUploadLink(LINK, SECRET, NOW);
  const i = Math.floor(token.length / 2);
  const flipped = token.slice(0, i) + (token[i] === "A" ? "B" : "A") + token.slice(i + 1);
  assert.equal(openUploadLink(flipped, SECRET, NOW), "invalid");
});

test("garbage does not open, and does not throw", () => {
  for (const token of ["", "abc", "!!!", "A".repeat(500)]) {
    assert.equal(openUploadLink(token, SECRET, NOW), "invalid");
  }
});

test("the draft's launch date at sealing time is kept, to make the link single-use", () => {
  const token = sealUploadLink({ ...LINK, launchedAt: "2026-10-13T11:00:00Z" }, SECRET, NOW);
  const opened = openUploadLink(token, SECRET, NOW);
  assert.ok(typeof opened === "object");
  assert.equal(opened.launchedAt, "2026-10-13T11:00:00Z");
});

test("an uploaded file is read as UTF-8 text", () => {
  assert.equal(uploadedText(Buffer.from('{"cells":[],"note":"déjà"}', "utf8")), '{"cells":[],"note":"déjà"}');
});

test("a gzipped upload is read the same, so a large run fits under the size limit", () => {
  const text = JSON.stringify({ cells: Array.from({ length: 50 }, (_, i) => ({ i })) });
  assert.equal(uploadedText(gzipSync(Buffer.from(text, "utf8"))), text);
});

test("a corrupt gzip upload says so instead of throwing", () => {
  const broken = gzipSync(Buffer.from("{}")).subarray(0, 8);
  assert.equal(uploadedText(broken), null);
});
