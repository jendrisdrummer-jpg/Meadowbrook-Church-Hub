import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrast, checkBrand, suggestShade, brandWarnings, hexToHsl, hslToHex, darkAccentText } from '../public/js/contrast.js';

test('contrast matches known WCAG pairs', () => {
  assert.equal(contrast('#000000', '#ffffff').toFixed(2), '21.00');
  assert.equal(contrast('#ffffff', '#ffffff').toFixed(2), '1.00');
  assert.equal(contrast('#777777', '#ffffff').toFixed(2), '4.48');
  assert.equal(contrast('#767676', '#ffffff').toFixed(2), '4.54');
});

test('HSL round trip', () => {
  for (const c of ['#135fd1', '#ff0000', '#808080', '#ffe066']) assert.equal(hslToHex(...hexToHsl(c)), c);
});

test('dark accent text lightens toward white', () => {
  assert.equal(darkAccentText('#000000'), '#666666');
  assert.equal(darkAccentText('#ffffff'), '#ffffff');
});

test('default blue passes everywhere', () => {
  assert.equal(checkBrand('#135fd1').ok, true);
  assert.deepEqual(brandWarnings('#135fd1'), []);
});

test('pale colour fails and gets a passing, darker suggestion', () => {
  assert.equal(checkBrand('#ffe066').ok, false);
  assert.ok(brandWarnings('#ffe066')[0].startsWith('White text'));
  const s = suggestShade('#ffe066');
  assert.ok(checkBrand(s).ok);
  assert.ok(hexToHsl(s)[2] < hexToHsl('#ffe066')[2]);
});

test('very dark colour fails on dark theme and gets a lighter suggestion', () => {
  assert.ok(checkBrand('#101010').dark < 4.5);
  const s = suggestShade('#101010');
  assert.ok(checkBrand(s).ok);
  assert.ok(hexToHsl(s)[2] > hexToHsl('#101010')[2]);
});

test('bad input is ignored', () => {
  assert.equal(suggestShade('nope'), null);
  assert.deepEqual(brandWarnings('nope'), []);
});
