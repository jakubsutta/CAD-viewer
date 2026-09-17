/* ---------------------------------------------------------------
   caddgn.js – čtení MicroStation DGN V8 přímo v prohlížeči.

   Formát V8 není veřejně dokumentovaný; tento parser vznikl
   analýzou reálných souborů. Pokrývá to, co je v geodetických
   výkresech běžné:
     3  LINE            4  LINE STRING     6  SHAPE
     15 ELLIPSE        16 ARC            17 TEXT
     2  CELL HEADER     7  TEXT NODE     12 COMPLEX CHAIN
     14 COMPLEX SHAPE   (prvky uvnitř se kreslí samostatně)
   Nepodporováno: kóty (33), B-spliny, rastry, 3D varianty textů
   a elips, reference na jiné soubory.

   Závislosti: CFB (compound file) – načte se z CDN při potřebě,
   inflate přes vestavěné DecompressionStream.
   --------------------------------------------------------------- */
(function (root) {
  'use strict';

  var CFB_URL = 'https://cdn.jsdelivr.net/npm/cfb@1.2.2/dist/cfb.min.js';

  /* výchozí paleta MicroStationu (index barvy 0–255) */
  var PCT = ['#FFFFFF','#0000FF','#00FF00','#FF0000','#FFFF00','#FF00FF','#FF7F00','#00FFFF','#404040','#C0C0C0','#FE0060','#A0E000','#00FEA0','#8000A0','#B0B0B0','#00F0F0','#F0F000','#B04000','#0000A0','#00A000','#A00000','#A0A000','#A000A0','#00A0A0','#606060','#808080','#A0A0A0','#C0C0FF','#C0FFC0','#FFC0C0','#FFFFC0','#FFC0FF','#C0FFFF','#800000','#804000','#808000','#008000','#008080','#000080','#400080','#800080','#FF8080','#FFBF80','#FFFF80','#80FF80','#80FFFF','#8080FF','#BF80FF','#FF80FF','#FF4040','#FF9F40','#FFFF40','#40FF40','#40FFFF','#4040FF','#9F40FF','#FF40FF','#BF0000','#BF6000','#BFBF00','#00BF00','#00BFBF','#0000BF','#6000BF','#BF00BF','#400000','#402000','#404000','#004000','#004040','#000040','#200040','#400040','#FFD0D0','#FFE8D0','#FFFFD0','#D0FFD0','#D0FFFF','#D0D0FF','#E8D0FF','#FFD0FF','#FF6060','#FFAF60','#FFFF60','#60FF60','#60FFFF','#6060FF','#AF60FF','#FF60FF','#DF0000','#DF7000','#DFDF00','#00DF00','#00DFDF','#0000DF','#7000DF','#DF00DF','#600000','#603000','#606000','#006000','#006060','#000060','#300060','#600060','#FFE8E8','#FFF3E8','#FFFFE8','#E8FFE8','#E8FFFF','#E8E8FF','#F3E8FF','#FFE8FF','#FF9090','#FFC790','#FFFF90','#90FF90','#90FFFF','#9090FF','#C790FF','#FF90FF','#9F0000','#9F5000','#9F9F00','#009F00','#009F9F','#00009F','#50009F','#9F009F','#200000','#201000','#202000','#002000','#002020','#000020','#100020','#200020','#F0F0F0','#E0E0E0','#D0D0D0','#C0C0C0','#B0B0B0','#A0A0A0','#909090','#808080','#707070','#606060','#505050','#404040','#303030','#202020','#101010','#000000','#FF0000','#FF1000','#FF2000','#FF3000','#FF4000','#FF5000','#FF6000','#FF7000','#FF8000','#FF9000','#FFA000','#FFB000','#FFC000','#FFD000','#FFE000','#FFF000','#FFFF00','#F0FF00','#E0FF00','#D0FF00','#C0FF00','#B0FF00','#A0FF00','#90FF00','#80FF00','#70FF00','#60FF00','#50FF00','#40FF00','#30FF00','#20FF00','#10FF00','#00FF00','#00FF10','#00FF20','#00FF30','#00FF40','#00FF50','#00FF60','#00FF70','#00FF80','#00FF90','#00FFA0','#00FFB0','#00FFC0','#00FFD0','#00FFE0','#00FFF0','#00FFFF','#00F0FF','#00E0FF','#00D0FF','#00C0FF','#00B0FF','#00A0FF','#0090FF','#0080FF','#0070FF','#0060FF','#0050FF','#0040FF','#0030FF','#0020FF','#0010FF','#0000FF','#1000FF','#2000FF','#3000FF','#4000FF','#5000FF','#6000FF','#7000FF','#8000FF','#9000FF','#A000FF','#B000FF','#C000FF','#D000FF','#E000FF','#F000FF','#FF00FF','#FF00F0','#FF00E0','#FF00D0','#FF00C0','#FF00B0','#FF00A0','#FF0090','#FF0080','#FF0070','#FF0060','#FF0050','#FF0040','#FF0030','#FF0020','#FF0010','#FFFFFF'];

  var HDR = 104;                 // délka společné hlavičky prvku
  var P_COMPLEX_HDR = 0x2000;    // prvek je hlavička komplexu/buňky
  var P_COMPLEX_MEMBER = 0x4000; // prvek je součástí komplexu/buňky

  var TYPE_NAME = {
    2: 'CELL', 3: 'LINE', 4: 'LINE STRING', 5: 'GROUP', 6: 'SHAPE', 7: 'TEXT NODE',
    11: 'CURVE', 12: 'COMPLEX CHAIN', 14: 'COMPLEX SHAPE', 15: 'ELLIPSE', 16: 'ARC',
    17: 'TEXT', 22: 'BSPLINE', 23: 'POINT STRING', 33: 'DIMENSION',
    34: 'SHARED CELL DEF', 35: 'SHARED CELL', 36: 'MULTILINE', 87: 'RASTER'
  };

  /* ---------- pomocné ---------- */

  function loadScript(url) {
    return new Promise(function (res, rej) {
      if (root.CFB) return res(root.CFB);
      var s = document.createElement('script');
      s.src = url;
      s.onload = function () { res(root.CFB); };
      s.onerror = function () { rej(new Error('Nepodařilo se načíst knihovnu CFB z ' + url)); };
      document.head.appendChild(s);
    });
  }

  async function inflate(u8) {
    if (typeof DecompressionStream !== 'function')
      throw new Error('Prohlížeč neumí DecompressionStream – DGN nelze rozbalit.');
    var ds = new DecompressionStream('deflate');
    var stream = new Blob([u8]).stream().pipeThrough(ds);
    var buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  /* stream DGN: 16B hlavička (počet prvků, druh komprese), pak zlib */
  async function unpackStream(u8) {
    if (u8.length > 17 && u8[16] === 0x78) return inflate(u8.subarray(16));
    if (u8.length > 1 && u8[0] === 0x78) return inflate(u8);
    return u8.subarray(16);
  }

  function readStr(u8, off, bytes, uni) {
    if (bytes <= 0) return '';
    var s = new TextDecoder(uni ? 'utf-16le' : 'windows-1250').decode(u8.subarray(off, off + bytes));
    var z = s.indexOf('\u0000');
    return z >= 0 ? s.slice(0, z) : s;
  }
  /* řetězec s případným příznakem 0xfffd = UTF-16 */
  function decodeStr(u8, off, bytes) {
    var uni = u8[off] === 0xff && u8[off + 1] === 0xfd;
    return readStr(u8, off + (uni ? 2 : 0), bytes - (uni ? 2 : 0), uni);
  }

  /* jméno (úrovně, buňky) uložené v linkage na konci prvku:
     hlavička linkage končí na geomEnd, pak druh(1) + délka + text */
  function tailName(u8, dv, geomEnd, end) {
    if (geomEnd + 8 > end) return '';
    if (dv.getUint32(geomEnd, true) !== 1) return '';
    var len = dv.getUint32(geomEnd + 4, true);
    if (!len || geomEnd + 8 + len > end) return '';
    return decodeStr(u8, geomEnd + 8, len);
  }

  function ptsAt(dv, from, n, stride, limit) {
    var a = [], k;
    for (k = 0; k < n; k++) {
      if (from + k * stride + 16 > limit) break;
      a.push([dv.getFloat64(from + k * stride, true), dv.getFloat64(from + k * stride + 8, true)]);
    }
    return a;
  }

  /* body elipsy (nezávisle na CadCore) */
  function ellPts(cx, cy, r1, r2, rot) {
    var out = [], n = 64, i, a, x, y;
    for (i = 0; i <= n; i++) {
      a = 2 * Math.PI * i / n; x = r1 * Math.cos(a); y = r2 * Math.sin(a);
      out.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
    }
    return out;
  }

  /* ---------- procházení prvků ---------- */

  function walk(u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var out = [], p = 4;
    while (p + 16 <= u8.length) {
      var lenA = dv.getUint32(p + 4, true);
      if (!lenA || p + 4 + lenA * 2 > u8.length) break;
      out.push({
        p: p,
        type: dv.getUint16(p, true) & 0xff,
        props: dv.getUint16(p + 2, true),
        end: p + 4 + lenA * 2,
        geomEnd: p + 4 + dv.getUint32(p + 8, true) * 2,
        level: dv.getUint32(p + 12, true),
        id: dv.getUint32(p + 16, true),
        style: dv.getUint32(p + 44, true),
        weight: dv.getUint32(p + 48, true),
        color: dv.getUint32(p + 52, true)
      });
      p += 4 + lenA * 2;
    }
    return { dv: dv, elems: out };
  }

  /* 2D nebo 3D? poznáme z délky prvního LINE / LINE STRING */
  function detect3d(dv, elems) {
    for (var i = 0; i < elems.length; i++) {
      var e = elems[i], body = e.geomEnd - e.p - HDR;
      if (e.type === 3) { if (body >= 48) return true; if (body >= 32) return false; }
      if (e.type === 4 || e.type === 6) {
        var n = dv.getUint32(e.p + HDR, true);
        if (n > 0) { var per = (e.geomEnd - e.p - HDR - 8) / n; if (per >= 23) return true; if (per >= 15) return false; }
      }
    }
    return false;
  }

  /* měřítko UOR → metry: zkusíme takové, při kterém data padnou do známého s.s. */
  function detectUor(bbox, detectCrs) {
    var cand = [1000, 10000, 1, 100, 10, 100000, 1000000];
    for (var i = 0; i < cand.length; i++) {
      var s = cand[i];
      var b = [bbox[0] / s, bbox[1] / s, bbox[2] / s, bbox[3] / s];
      if (detectCrs(b).code) return s;
    }
    return 1000;
  }

  /* ---------- hlavní parser ---------- */

  async function parseDgn(arrayBuffer, fileName, core) {
    var CFB = root.CFB || await loadScript(CFB_URL);
    var cfb = CFB.read(new Uint8Array(arrayBuffer), { type: 'array' });

    var gstreams = [], nstream = null, i;
    for (i = 0; i < cfb.FullPaths.length; i++) {
      var pth = cfb.FullPaths[i], fi = cfb.FileIndex[i];
      if (!fi || fi.type !== 2) continue;
      if (/Dgn-Md\/.*\/Dgn\^G\/\$1$/.test(pth)) gstreams.push(fi);
      else if (/Dgn\^Nm\/\$1$/.test(pth)) nstream = fi;
    }
    if (!gstreams.length) throw new Error('V souboru nejsou grafická data DGN V8 (možná je to DGN V7).');

    /* tabulka úrovní (názvy) */
    var levelNames = {};
    if (nstream) {
      try {
        var nb = await unpackStream(new Uint8Array(nstream.content));
        var nw = walk(nb);
        for (i = 0; i < nw.elems.length; i++) {
          var le = nw.elems[i];
          if (le.type !== 95) continue;
          var lid = nw.dv.getInt32(le.p + 32, true);
          var nm = tailName(nb, nw.dv, le.geomEnd, le.end);
          if (nm && levelNames[lid] === undefined) levelNames[lid] = nm;
        }
      } catch (err) { /* názvy úrovní jsou nice-to-have */ }
    }

    var raw = [], skipped = {}, bbox = [Infinity, Infinity, -Infinity, -Infinity];
    var is3d = false;

    for (var gi = 0; gi < gstreams.length; gi++) {
      var gb = await unpackStream(new Uint8Array(gstreams[gi].content));
      var w = walk(gb), dv = w.dv;
      if (gi === 0) is3d = detect3d(dv, w.elems);
      var stride = is3d ? 24 : 16;
      var cell = '';

      for (i = 0; i < w.elems.length; i++) {
        var e = w.elems[i], p = e.p, g = null, props = {};

        if (e.props & P_COMPLEX_HDR) {
          cell = tailName(gb, dv, e.geomEnd, e.end);
          if (e.type === 2) continue;              // buňku samotnou nekreslíme
        } else if (!(e.props & P_COMPLEX_MEMBER)) {
          cell = '';
        }

        switch (e.type) {
          case 3:
            g = { kind: 'line', coords: ptsAt(dv, p + HDR, 2, stride, e.geomEnd) }; break;
          case 4: case 6: case 11: {
            var n = dv.getUint32(p + HDR, true);
            if (n < 1 || n > 100000) { skipped[TYPE_NAME[e.type] || e.type] = (skipped[TYPE_NAME[e.type] || e.type] || 0) + 1; break; }
            var c = ptsAt(dv, p + HDR + 8, n, stride, e.geomEnd);
            if (e.type === 6 && c.length > 2) c.push(c[0].slice());
            g = { kind: 'line', coords: c };
            props['vrcholů'] = c.length;
            break;
          }
          case 15: {                                  // elipsa / kružnice
            if (is3d) break;
            var r1 = dv.getFloat64(p + HDR, true), r2 = dv.getFloat64(p + HDR + 8, true);
            var rot = dv.getFloat64(p + HDR + 16, true);
            var ox = dv.getFloat64(p + HDR + 24, true), oy = dv.getFloat64(p + HDR + 32, true);
            g = { kind: 'line', coords: ellPts(ox, oy, r1, r2, rot) };
            props['poloměr'] = r1;
            break;
          }
          case 16: {                                  // oblouk
            if (is3d) break;
            var a0 = dv.getFloat64(p + HDR, true), sw = dv.getFloat64(p + HDR + 8, true);
            var ar1 = dv.getFloat64(p + HDR + 16, true);
            var arot = dv.getFloat64(p + HDR + 32, true);
            var aox = dv.getFloat64(p + HDR + 40, true), aoy = dv.getFloat64(p + HDR + 48, true);
            g = { kind: 'line', coords: core.arcPts(aox, aoy, ar1, a0 + arot, a0 + arot + sw, sw > 0) };
            break;
          }
          case 17: {                                  // text
            if (is3d) break;
            var nch = dv.getUint16(p + HDR + 6, true);
            var th = dv.getFloat64(p + HDR + 32, true);
            if (!th) { skipped['Řídicí prvek (bez výšky)'] = (skipped['Řídicí prvek (bez výšky)'] || 0) + 1; break; }
            var trot = dv.getFloat64(p + HDR + 40, true);
            var tx = dv.getFloat64(p + HDR + 48, true), ty = dv.getFloat64(p + HDR + 56, true);
            var uni = gb[p + HDR + 64] === 0xff && gb[p + HDR + 65] === 0xfd;
            var so = p + HDR + 66;
            var tb = Math.min(nch * (uni ? 2 : 1), Math.max(0, e.geomEnd - so));
            var txt = readStr(gb, so, tb, uni);
            g = { kind: 'text', coords: [[tx, ty]] };
            props.text = txt; props['výška'] = th; props['rotace'] = trot;
            break;
          }
          case 7: case 12: case 14:
            continue;                                  // hlavičky komplexů – členy jdou zvlášť
          default:
            var nmt = TYPE_NAME[e.type] || ('typ ' + e.type);
            skipped[nmt] = (skipped[nmt] || 0) + 1;
        }
        if (!g || !g.coords.length) continue;

        if (cell) props['buňka'] = cell;
        if (e.weight) props['tloušťka'] = e.weight;
        raw.push({
          type: TYPE_NAME[e.type] || ('typ ' + e.type),
          level: e.level, color: e.color, kind: g.kind, coords: g.coords,
          handle: String(e.id), props: props
        });
        for (var q = 0; q < g.coords.length; q++) {
          var x = g.coords[q][0], y = g.coords[q][1];
          if (x < bbox[0]) bbox[0] = x; if (y < bbox[1]) bbox[1] = y;
          if (x > bbox[2]) bbox[2] = x; if (y > bbox[3]) bbox[3] = y;
        }
      }
    }
    /* classify DGN geometry kinds for layer icons */
    function classifyDgnKind(f) {
      var t = f.type;
      if (f.kind === 'text') return 'text';
      if (f.kind === 'point') return 'point';
      if (t === 'SHAPE') return 'polygon';
      if (t === 'ELLIPSE') {
        // full ellipse or circle
        return 'ellipse';
      }
      if (t === 'ARC') return 'arc';
      if (t === 'LINE STRING') return 'polyline';
      if (t === 'LINE') return 'line';
      return 'line';
    }

    if (!raw.length) throw new Error('V DGN nejsou žádné podporované prvky.');

    /* měřítko a přepočet na metry */
    var uor = detectUor(bbox, core.detectCrs);
    var layers = {}, features = [], bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (i = 0; i < raw.length; i++) {
      var f = raw[i], cs = f.coords, j;
      for (j = 0; j < cs.length; j++) {
        cs[j][0] /= uor; cs[j][1] /= uor;
        if (cs[j][0] < bb[0]) bb[0] = cs[j][0]; if (cs[j][1] < bb[1]) bb[1] = cs[j][1];
        if (cs[j][0] > bb[2]) bb[2] = cs[j][0]; if (cs[j][1] > bb[3]) bb[3] = cs[j][1];
      }
      if (f.props['výška']) f.props['výška'] /= uor;
      if (f.props['poloměr']) f.props['poloměr'] /= uor;
      var lname = levelNames[f.level] || ('Úroveň ' + f.level);
      var col = (f.color === 0xffffffff || f.color >= PCT.length) ? PCT[0] : PCT[f.color];
      if (!layers[lname]) layers[lname] = { name: lname, aci: 7, rgb: col, count: 0, level: f.level, colors: {}, kinds: {} };
      layers[lname].count++;
      layers[lname].colors[col] = (layers[lname].colors[col] || 0) + 1;
      var gk = classifyDgnKind(f);
      layers[lname].kinds[gk] = (layers[lname].kinds[gk] || 0) + 1;
      f.props['úroveň'] = f.level;
      if (f.color !== 0xffffffff) f.props['barva DGN'] = f.color;
      features.push({
        id: features.length, type: f.type, layer: lname,
        aci: col === '#FFFFFF' ? 7 : 256, rgb: col === '#FFFFFF' ? null : col,
        kind: f.kind, coords: cs, handle: f.handle, props: f.props
      });
    }
    var ls = [], k;
    for (k in layers) {
      var l = layers[k], best = null, bc = -1, cc;
      for (cc in l.colors) if (l.colors[cc] > bc) { bc = l.colors[cc]; best = cc; }
      l.rgb = best || l.rgb; delete l.colors;
      ls.push(l);
    }
    ls.sort(function (a, b) { return a.name.localeCompare(b.name, 'cs'); });

    return {
      source: fileName, features: features, layers: ls, bbox: bb, skipped: skipped,
      info: { uor: uor, is3d: is3d, levels: ls.length, models: gstreams.length }
    };
  }

  var api = { parseDgn: parseDgn, PCT: PCT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CadDgn = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));