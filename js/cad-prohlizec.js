/* ---------------------------------------------------------------
   cadcore.js – parsing/normalizace CAD dat (DWG přes libredwg-web,
   DXF přes dxf-parser) do jednotného modelu pro vykreslení v mapě.
   --------------------------------------------------------------- */
(function (root) {
  'use strict';

  /* AutoCAD Color Index 0–255 */
  var ACI = ['#000000', '#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FFFFFF', '#414141', '#808080', '#FF0000', '#FFAAAA', '#BD0000', '#BD7E7E', '#810000', '#815656', '#680000', '#684545', '#4F0000', '#4F3535', '#FF3F00', '#FFBFAA', '#BD2E00', '#BD8D7E', '#811F00', '#816056', '#681900', '#684E45', '#4F1300', '#4F3B35', '#FF7F00', '#FFD4AA', '#BD5E00', '#BD9D7E', '#814000', '#816B56', '#683400', '#685645', '#4F2700', '#4F4235', '#FFBF00', '#FFEAAA', '#BD8D00', '#BDAD7E', '#816000', '#817656', '#684E00', '#685F45', '#4F3B00', '#4F4935', '#FFFF00', '#FFFFAA', '#BDBD00', '#BDBD7E', '#818100', '#818156', '#686800', '#686845', '#4F4F00', '#4F4F35', '#BFFF00', '#EAFFAA', '#8DBD00', '#ADBD7E', '#608100', '#768156', '#4E6800', '#5F6845', '#3B4F00', '#494F35', '#7FFF00', '#D4FFAA', '#5EBD00', '#9DBD7E', '#408100', '#6B8156', '#346800', '#566845', '#274F00', '#424F35', '#3FFF00', '#BFFFAA', '#2EBD00', '#8DBD7E', '#1F8100', '#608156', '#196800', '#4E6845', '#134F00', '#3B4F35', '#00FF00', '#AAFFAA', '#00BD00', '#7EBD7E', '#008100', '#568156', '#006800', '#456845', '#004F00', '#354F35', '#00FF3F', '#AAFFBF', '#00BD2E', '#7EBD8D', '#00811F', '#568160', '#006819', '#45684E', '#004F13', '#354F3B', '#00FF7F', '#AAFFD4', '#00BD5E', '#7EBD9D', '#008140', '#56816B', '#006834', '#456856', '#004F27', '#354F42', '#00FFBF', '#AAFFEA', '#00BD8D', '#7EBDAD', '#008160', '#568176', '#00684E', '#45685F', '#004F3B', '#354F49', '#00FFFF', '#AAFFFF', '#00BDBD', '#7EBDBD', '#008181', '#568181', '#006868', '#456868', '#004F4F', '#354F4F', '#00BFFF', '#AAEAFF', '#008DBD', '#7EADBD', '#006081', '#567681', '#004E68', '#455F68', '#003B4F', '#35494F', '#007FFF', '#AAD4FF', '#005EBD', '#7E9DBD', '#004081', '#566B81', '#003468', '#455668', '#00274F', '#35424F', '#003FFF', '#AABFFF', '#002EBD', '#7E8DBD', '#001F81', '#566081', '#001968', '#454E68', '#00134F', '#353B4F', '#0000FF', '#AAAAFF', '#0000BD', '#7E7EBD', '#000081', '#565681', '#000068', '#454568', '#00004F', '#35354F', '#3F00FF', '#BFAAFF', '#2E00BD', '#8D7EBD', '#1F0081', '#605681', '#190068', '#4E4568', '#13004F', '#3B354F', '#7F00FF', '#D4AAFF', '#5E00BD', '#9D7EBD', '#400081', '#6B5681', '#340068', '#564568', '#27004F', '#42354F', '#BF00FF', '#EAAAFF', '#8D00BD', '#AD7EBD', '#600081', '#765681', '#4E0068', '#5F4568', '#3B004F', '#49354F', '#FF00FF', '#FFAAFF', '#BD00BD', '#BD7EBD', '#810081', '#815681', '#680068', '#684568', '#4F004F', '#4F354F', '#FF00BF', '#FFAAEA', '#BD008D', '#BD7EAD', '#810060', '#815676', '#68004E', '#68455F', '#4F003B', '#4F3549', '#FF007F', '#FFAAD4', '#BD005E', '#BD7E9D', '#810040', '#81566B', '#680034', '#684556', '#4F0027', '#4F3542', '#FF003F', '#FFAABF', '#BD002E', '#BD7E8D', '#81001F', '#815660', '#680019', '#68454E', '#4F0013', '#4F353B', '#333333', '#505050', '#696969', '#828282', '#BEBEBE', '#FFFFFF'];

  var BYLAYER = 256, BYBLOCK = 0;

  function aciHex(i) {
    i = Math.abs(i | 0);
    return (i >= 0 && i < 256) ? ACI[i] : '#FFFFFF';
  }

  /* --- geometrie ------------------------------------------------ */

  function arcPts(cx, cy, r, a0, a1, ccw) {
    // úhly v radiánech
    if (ccw === undefined) ccw = true;
    var sweep = a1 - a0;
    while (sweep <= 0) sweep += 2 * Math.PI;
    if (!ccw) sweep = sweep - 2 * Math.PI;
    var n = Math.max(6, Math.min(180, Math.ceil(Math.abs(sweep) / (Math.PI / 36))));
    var out = [];
    for (var i = 0; i <= n; i++) {
      var a = a0 + sweep * (i / n);
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return out;
  }

  function bulgePts(p0, p1, bulge) {
    // oblouk mezi dvěma vrcholy LWPOLYLINE daný bulge
    var dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    var chord = Math.hypot(dx, dy);
    if (!chord || !bulge) return [p1];
    var theta = 4 * Math.atan(bulge);           // středový úhel
    var r = chord / (2 * Math.sin(Math.abs(theta) / 2));
    var mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
    var h = r * Math.cos(theta / 2);
    var ux = -dy / chord, uy = dx / chord;
    var sgn = bulge > 0 ? 1 : -1;
    var cx = mx + ux * h * sgn, cy = my + uy * h * sgn;
    var a0 = Math.atan2(p0[1] - cy, p0[0] - cx);
    var n = Math.max(4, Math.min(120, Math.ceil(Math.abs(theta) / (Math.PI / 36))));
    var out = [];
    for (var i = 1; i <= n; i++) out.push([
      cx + r * Math.cos(a0 + theta * (i / n)),
      cy + r * Math.sin(a0 + theta * (i / n))
    ]);
    return out;
  }

  function ellipsePts(cx, cy, majX, majY, ratio, s, e) {
    var maj = Math.hypot(majX, majY), min = maj * (ratio || 1);
    var rot = Math.atan2(majY, majX);
    if (s === undefined || e === undefined || (s === 0 && e === 0)) { s = 0; e = 2 * Math.PI; }
    var sweep = e - s; while (sweep <= 0) sweep += 2 * Math.PI;
    var n = Math.max(12, Math.min(180, Math.ceil(sweep / (Math.PI / 36))));
    var out = [];
    for (var i = 0; i <= n; i++) {
      var a = s + sweep * (i / n);
      var x = maj * Math.cos(a), y = min * Math.sin(a);
      out.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
    }
    return out;
  }

  function xf(m, p) {          // afinní transformace [a,b,c,d,e,f]
    return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
  }
  function mkMat(ins, sx, sy, rot) {
    var c = Math.cos(rot || 0), s = Math.sin(rot || 0);
    return [sx * c, sx * s, -sy * s, sy * c, ins[0], ins[1]];
  }
  function mulMat(m, n) {      // m ∘ n  (nejprve n, pak m)
    return [
      m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
    ];
  }

  /* --- klasifikace geometrie pro vrstvu --------------------------- */
  function classifyGeoKind(f) {
    var t = (f.type || '').toUpperCase();
    switch (t) {
      case 'POINT': return 'point';
      case 'TEXT': case 'MTEXT': case 'ATTRIB': return 'text';
      case 'CIRCLE': return 'circle';
      case 'ARC': return 'arc';
      case 'ELLIPSE': return 'ellipse';
      case 'SPLINE': return 'spline';
      case 'LINE': return 'line';
      case 'SOLID': case '3DFACE': return 'polygon';
      case 'LWPOLYLINE': case 'POLYLINE':
        // Check if closed polygon
        if (f.props && f.props['uzavřený'] === 'ano') return 'polygon';
        return 'polyline';
      default:
        if (f.kind === 'text') return 'text';
        if (f.kind === 'point') return 'point';
        return 'line';
    }
  }

  /* --- společný sběrač ------------------------------------------ */

  function Collector() {
    this.features = [];
    this.layers = {};        // name -> {name, aci, count}
    this.skipped = {};
    this.bbox = [Infinity, Infinity, -Infinity, -Infinity];
  }
  Collector.prototype.layer = function (name, aci) {
    if (!this.layers[name]) this.layers[name] = { name: name, aci: (aci === undefined ? 7 : aci), count: 0, kinds: {} };
    return this.layers[name];
  };
  Collector.prototype.add = function (f) {
    var b = this.bbox, cs = f.coords, i;
    for (i = 0; i < cs.length; i++) {
      if (cs[i][0] < b[0]) b[0] = cs[i][0];
      if (cs[i][1] < b[1]) b[1] = cs[i][1];
      if (cs[i][0] > b[2]) b[2] = cs[i][0];
      if (cs[i][1] > b[3]) b[3] = cs[i][1];
    }
    f.id = this.features.length;
    this.features.push(f);
    var lay = this.layer(f.layer);
    lay.count++;
    // Track geometry type breakdown: use geoKind for grouping
    var gk = classifyGeoKind(f);
    lay.kinds[gk] = (lay.kinds[gk] || 0) + 1;
  };
  Collector.prototype.skip = function (t) { this.skipped[t] = (this.skipped[t] || 0) + 1; };
  Collector.prototype.result = function (src) {
    var ls = [], k;
    for (k in this.layers) if (this.layers[k].count > 0) ls.push(this.layers[k]);
    ls.sort(function (a, b) { return a.name.localeCompare(b.name, 'cs'); });
    return { source: src, features: this.features, layers: ls, bbox: this.bbox, skipped: this.skipped };
  };

  /* --- DWG (libredwg-web DwgDatabase) --------------------------- */

  function normalizeDwg(db, fileName) {
    var col = new Collector(), i;
    var layerTab = (db.tables && db.tables.LAYER && db.tables.LAYER.entries) || [];
    for (i = 0; i < layerTab.length; i++) col.layer(layerTab[i].name, layerTab[i].colorIndex);
    var blocks = {};
    var brs = (db.tables && db.tables.BLOCK_RECORD && db.tables.BLOCK_RECORD.entries) || [];
    for (i = 0; i < brs.length; i++) blocks[brs[i].name] = brs[i];
    walk(db.entities || [], [1, 0, 0, 1, 0, 0], null, 0);

    function pt(p) { return [p.x, p.y]; }
    function walk(ents, mat, parentColor, depth) {
      for (var j = 0; j < ents.length; j++) {
        var e = ents[j];
        var aci = e.colorIndex;
        if (aci === BYBLOCK && parentColor != null) aci = parentColor;
        emit(e, aci, mat, depth);
      }
    }
    function push(e, aci, kind, coords, mat, extra) {
      var out = [], k;
      for (k = 0; k < coords.length; k++) out.push(xf(mat, coords[k]));
      var f = {
        type: e.type, layer: e.layer || '0', aci: aci, kind: kind, coords: out,
        handle: e.handle, props: extra || {}
      };
      f.props.lineType = e.lineType || '';
      f.props.lineweight = e.lineweight;
      col.add(f);
    }
    function emit(e, aci, mat, depth) {
      switch (e.type) {
        case 'LINE':
          push(e, aci, 'line', [pt(e.startPoint), pt(e.endPoint)], mat); break;
        case 'LWPOLYLINE':
        case 'POLYLINE': {
          var vs = e.vertices || [], pts = [], k;
          if (!vs.length) { col.skip(e.type); break; }
          pts.push(pt(vs[0]));
          for (k = 1; k < vs.length; k++) {
            var b = vs[k - 1].bulge || 0;
            if (b) pts = pts.concat(bulgePts(pt(vs[k - 1]), pt(vs[k]), b)); else pts.push(pt(vs[k]));
          }
          var closed = !!(e.flag & 512) || !!(e.isClosed) || !!(e.flag & 1 && e.type === 'POLYLINE');
          if (closed && vs.length > 2) {
            var lb = vs[vs.length - 1].bulge || 0;
            if (lb) pts = pts.concat(bulgePts(pt(vs[vs.length - 1]), pt(vs[0]), lb)); else pts.push(pt(vs[0]));
          }
          push(e, aci, 'line', pts, mat, { vrcholů: vs.length, uzavřený: closed ? 'ano' : 'ne' });
          break;
        }
        case 'CIRCLE':
          push(e, aci, 'line', arcPts(e.center.x, e.center.y, e.radius, 0, 2 * Math.PI), mat, { poloměr: e.radius }); break;
        case 'ARC':
          push(e, aci, 'line', arcPts(e.center.x, e.center.y, e.radius, e.startAngle, e.endAngle), mat, { poloměr: e.radius }); break;
        case 'ELLIPSE':
          push(e, aci, 'line', ellipsePts(e.center.x, e.center.y, e.majorAxisEndPoint.x, e.majorAxisEndPoint.y,
            e.axisRatio, e.startAngle, e.endAngle), mat); break;
        case 'POINT':
          push(e, aci, 'point', [pt(e.position || e.point || { x: 0, y: 0 })], mat); break;
        case 'TEXT':
        case 'ATTRIB':
          push(e, aci, 'text', [pt(e.startPoint)], mat,
            { text: e.text, výška: e.textHeight, rotace: e.rotation || 0, styl: e.styleName }); break;
        case 'MTEXT':
          push(e, aci, 'text', [pt(e.insertionPoint || e.startPoint)], mat,
            { text: String(e.text || '').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, ''), výška: e.height || e.textHeight, rotace: e.rotation || 0 }); break;
        case 'SPLINE': {
          var cp = e.fitPoints && e.fitPoints.length ? e.fitPoints : e.controlPoints;
          if (!cp || !cp.length) { col.skip('SPLINE'); break; }
          push(e, aci, 'line', cp.map(pt), mat); break;
        }
        case 'SOLID':
        case '3DFACE': {
          var ps = [e.corner1 || e.point1, e.corner2 || e.point2, e.corner3 || e.point3, e.corner4 || e.point4]
            .filter(Boolean).map(pt);
          if (ps.length) { ps.push(ps[0]); push(e, aci, 'line', ps, mat); }
          break;
        }
        case 'INSERT': {
          var blk = blocks[e.name];
          if (!blk || depth > 4) { col.skip('INSERT'); break; }
          var m = mulMat(mat, mkMat(pt(e.insertionPoint), e.xScale || 1, e.yScale || 1, e.rotation || 0));
          if (blk.basePoint && (blk.basePoint.x || blk.basePoint.y))
            m = mulMat(m, [1, 0, 0, 1, -blk.basePoint.x, -blk.basePoint.y]);
          walk(blk.entities || [], m, aci === BYLAYER ? null : aci, depth + 1);
          if (e.attribs && e.attribs.length) walk(e.attribs, mat, aci, depth + 1);
          break;
        }
        default: col.skip(e.type);
      }
    }
    return col.result(fileName);
  }

  /* --- DXF (dxf-parser) ----------------------------------------- */

  function normalizeDxf(dxf, fileName) {
    var col = new Collector(), name;
    var lt = dxf.tables && dxf.tables.layer && dxf.tables.layer.layers;
    for (name in (lt || {})) col.layer(name, lt[name].colorIndex);
    var blocks = dxf.blocks || {};
    walk(dxf.entities || [], [1, 0, 0, 1, 0, 0], null, 0);

    function pt(p) { return [p.x, p.y]; }
    function walk(ents, mat, parentColor, depth) {
      for (var j = 0; j < ents.length; j++) {
        var e = ents[j], aci = (e.colorIndex === undefined ? BYLAYER : e.colorIndex);
        if (aci === BYBLOCK && parentColor != null) aci = parentColor;
        emit(e, aci, mat, depth);
      }
    }
    function push(e, aci, kind, coords, mat, extra) {
      var out = [], k;
      for (k = 0; k < coords.length; k++) out.push(xf(mat, coords[k]));
      var f = {
        type: e.type, layer: e.layer || '0', aci: aci, kind: kind, coords: out,
        handle: e.handle, props: extra || {}
      };
      if (e.color !== undefined && e.colorIndex === undefined) f.rgb = '#' + ('000000' + e.color.toString(16)).slice(-6);
      f.props.lineType = e.lineType || '';
      col.add(f);
    }
    function emit(e, aci, mat, depth) {
      switch (e.type) {
        case 'LINE':
          if (!e.vertices || e.vertices.length < 2) { col.skip('LINE'); break; }
          push(e, aci, 'line', e.vertices.map(pt), mat); break;
        case 'LWPOLYLINE':
        case 'POLYLINE': {
          var vs = e.vertices || [], pts = [], k;
          if (!vs.length) { col.skip(e.type); break; }
          pts.push(pt(vs[0]));
          for (k = 1; k < vs.length; k++) {
            var b = vs[k - 1].bulge || 0;
            if (b) pts = pts.concat(bulgePts(pt(vs[k - 1]), pt(vs[k]), b)); else pts.push(pt(vs[k]));
          }
          if (e.shape && vs.length > 2) {
            var lb = vs[vs.length - 1].bulge || 0;
            if (lb) pts = pts.concat(bulgePts(pt(vs[vs.length - 1]), pt(vs[0]), lb)); else pts.push(pt(vs[0]));
          }
          push(e, aci, 'line', pts, mat, { vrcholů: vs.length, uzavřený: e.shape ? 'ano' : 'ne' });
          break;
        }
        case 'CIRCLE':
          push(e, aci, 'line', arcPts(e.center.x, e.center.y, e.radius, 0, 2 * Math.PI), mat, { poloměr: e.radius }); break;
        case 'ARC':
          push(e, aci, 'line', arcPts(e.center.x, e.center.y, e.radius,
            (e.startAngle || 0), (e.endAngle || 0)), mat, { poloměr: e.radius }); break;
        case 'ELLIPSE':
          push(e, aci, 'line', ellipsePts(e.center.x, e.center.y,
            e.majorAxisEndPoint.x, e.majorAxisEndPoint.y, e.axisRatio, e.startAngle, e.endAngle), mat); break;
        case 'POINT':
          push(e, aci, 'point', [pt(e.position)], mat); break;
        case 'TEXT':
        case 'ATTRIB':
          push(e, aci, 'text', [pt(e.startPoint)], mat,
            { text: e.text, výška: e.textHeight, rotace: (e.rotation || 0) * Math.PI / 180, styl: e.styleName }); break;
        case 'MTEXT':
          push(e, aci, 'text', [pt(e.position)], mat,
            { text: String(e.text || '').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, ''), výška: e.height, rotace: (e.rotation || 0) * Math.PI / 180 }); break;
        case 'SPLINE': {
          var cp = e.fitPoints && e.fitPoints.length ? e.fitPoints : e.controlPoints;
          if (!cp || !cp.length) { col.skip('SPLINE'); break; }
          push(e, aci, 'line', cp.map(pt), mat); break;
        }
        case 'SOLID':
        case '3DFACE': {
          var ps = (e.points || []).map(pt);
          if (ps.length) { ps.push(ps[0]); push(e, aci, 'line', ps, mat); }
          break;
        }
        case 'INSERT': {
          var blk = blocks[e.name];
          if (!blk || depth > 4) { col.skip('INSERT'); break; }
          var m = mulMat(mat, mkMat(pt(e.position), e.xScale || 1, e.yScale || 1, (e.rotation || 0) * Math.PI / 180));
          if (blk.position && (blk.position.x || blk.position.y))
            m = mulMat(m, [1, 0, 0, 1, -blk.position.x, -blk.position.y]);
          walk(blk.entities || [], m, aci === BYLAYER ? null : aci, depth + 1);
          break;
        }
        default: col.skip(e.type);
      }
    }
    return col.result(fileName);
  }

  /* --- detekce souřadnicového systému --------------------------- */
  // vrací {code, swap, negate} – jak upravit [x,y] před proj4 transformací
  function detectCrs(bbox) {
    var cx = (bbox[0] + bbox[2]) / 2, cy = (bbox[1] + bbox[3]) / 2;
    var ax = Math.abs(cx), ay = Math.abs(cy);
    var inY = function (v) { return v > 400000 && v < 950000; };   // JTSK Y
    var inX = function (v) { return v > 900000 && v < 1250000; };  // JTSK X
    if (inY(ax) && inX(ay)) return { code: 'EPSG:5514', swap: false, negate: cx > 0 };
    if (inX(ax) && inY(ay)) return { code: 'EPSG:5514', swap: true, negate: cx > 0 };
    if (ax <= 180 && ay <= 90) return { code: 'EPSG:4326', swap: false, negate: false };
    if (cx > 100000 && cx < 900000 && cy > 5200000 && cy < 5800000) return { code: 'EPSG:32633', swap: false, negate: false };
    if (Math.abs(cx) < 2.2e7 && Math.abs(cy) < 2.2e7 && (ax > 1e6 || ay > 1e6)) return { code: 'EPSG:3857', swap: false, negate: false };
    return { code: null, swap: false, negate: false };
  }

  var api = {
    ACI: ACI, aciHex: aciHex, normalizeDwg: normalizeDwg, normalizeDxf: normalizeDxf,
    detectCrs: detectCrs, arcPts: arcPts, bulgePts: bulgePts
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CadCore = api;
})(typeof self !== 'undefined' ? self : this);


(function () {
  'use strict';
  var C = window.CadCore;

  /* ---------- souřadnicové systémy ---------- */
  proj4.defs('EPSG:5514', '+proj=krovak +lat_0=49.5 +lon_0=24.8333333333333 +alpha=30.2881397527778 ' +
    '+k=0.9999 +x_0=0 +y_0=0 +ellps=bessel +towgs84=570.8285,85.6769,462.842,4.9984,1.5867,5.2611,3.5623 +units=m +no_defs');
  proj4.defs('EPSG:32633', '+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs');

  function makeProjector(mode, bbox) {
    var det = { code: mode, swap: false, negate: false, auto: false };
    if (mode === 'auto') { det = C.detectCrs(bbox); det.auto = true; }
    else if (mode === 'JTSK+') { det = { code: 'EPSG:5514', swap: false, negate: true, auto: false }; }
    if (!det.code) return null;
    var code = det.code;
    var fwd = function (x, y) {
      var a = x, b = y;
      if (det.swap) { var t = a; a = b; b = t; }
      if (det.negate) { a = -Math.abs(a); b = -Math.abs(b); }
      var ll = proj4(code, 'EPSG:4326', [a, b]);
      return [ll[1], ll[0]];                                    // [lat, lon]
    };
    if (code === 'EPSG:4326') fwd = function (x, y) { return [y, x]; };
    var inv = function (lat, lon) {
      if (code === 'EPSG:4326') return [lon, lat];
      return proj4('EPSG:4326', code, [lon, lat]);
    };
    return { code: code, swap: det.swap, negate: det.negate, auto: det.auto, fwd: fwd, inv: inv };
  }

  var CRS_LABEL = {
    'EPSG:5514': 'S-JTSK / Krovak East North (EPSG:5514)',
    'EPSG:4326': 'WGS 84 (EPSG:4326)',
    'EPSG:32633': 'WGS 84 / UTM 33N (EPSG:32633)',
    'EPSG:3857': 'Web Mercator (EPSG:3857)'
  };

  /* ---------- mapa ---------- */
  var map = L.map('map', {
    preferCanvas: true, maxZoom: 22, zoomControl: true, attributionControl: true,
    renderer: L.canvas({ tolerance: 6, padding: 0.4 })
  })
    .setView([49.8, 15.7], 8);
  L.control.scale({ imperial: false }).addTo(map);

  var bases = {
    osm: L.tileLayer.wms('https://www.edpp.cz/geoserver/wms', {
      layers: 'osm:envi_osm',
      format: 'image/png',
      maxZoom: 22,
      attribution: 'Mapová data &copy; EDPP, OpenStreetMap'
    }),
    ortofoto: L.tileLayer(
      'https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/WMTS/tile/1.0.0/ORTOFOTO_WM/default/default028mm/{z}/{y}/{x}', {
      maxZoom: 22, maxNativeZoom: 19, attribution: 'Ortofoto ČR &copy; ČÚZK'
    })
  };
  var baseName = 'ortofoto';
  bases.ortofoto.addTo(map);

  function setBase(name) {
    Object.keys(bases).forEach(function (k) { if (map.hasLayer(bases[k])) map.removeLayer(bases[k]); });
    baseName = name;
    if (bases[name]) { bases[name].addTo(map); bases[name].setOpacity(document.getElementById('opa').value / 100); bases[name].bringToBack(); }
    restyleAll();
  }
  document.getElementById('base').value = baseName;
  document.getElementById('base').onchange = function () { setBase(this.value); };
  document.getElementById('opa').oninput = function () { if (bases[baseName]) bases[baseName].setOpacity(this.value / 100); };

  /* WMS - Administrativní členění (CENIA + EDPP popisky) */
  var wmsCenia = L.tileLayer.wms('https://gis.cenia.cz/geoserver/spravni_cleneni/wms', {
    layers: 'spravni_cleneni',
    format: 'image/png',
    transparent: true,
    attribution: 'Hranice &copy; CENIA',
    maxZoom: 22
  });
  
  var wmsEdpp = L.tileLayer.wms('https://www.edpp.cz/geoserver/wms', {
    layers: 'osm:places',
    format: 'image/png',
    transparent: true,
    attribution: 'Názvy &copy; EDPP',
    maxZoom: 22
  });

  var wmsStat = L.tileLayer.wms('https://ags.cuzk.gov.cz/arcgis/services/RUIAN/MapServer/WMSServer', {
    layers: 'Stat',
    format: 'image/png',
    transparent: true,
    attribution: 'Státní hranice &copy; ČÚZK',
    maxZoom: 22
  });

  var adminGroup = L.layerGroup([wmsCenia, wmsStat, wmsEdpp]);

  var chkAdmin = document.getElementById('showadmin');
  if (chkAdmin) {
    chkAdmin.onchange = function () {
      if (this.checked) adminGroup.addTo(map);
      else map.removeLayer(adminGroup);
    };
  }
  var btnOpaAdmin = document.getElementById('btn-opa-admin');
  if (btnOpaAdmin) {
    btnOpaAdmin.onclick = function () {
      var w = document.getElementById('opa-wrap-admin');
      w.style.display = w.style.display === 'none' ? 'flex' : 'none';
    };
  }
  var opaAdmin = document.getElementById('opa-admin');
  if (opaAdmin) {
    opaAdmin.oninput = function () {
      var op = this.value / 100;
      adminGroup.eachLayer(function (layer) {
        if (layer.setOpacity) layer.setOpacity(op);
      });
    };
  }

  /* WMS - Hranice parcel ČÚZK */
  var wmsParcel = L.tileLayer.wms('https://services.cuzk.cz/wms/local-km-wms.asp', {
    layers: 'KN',
    format: 'image/png',
    transparent: true,
    attribution: 'Katastrální mapa &copy; ČÚZK',
    maxZoom: 22
  });

  var chkParcel = document.getElementById('showparcel');
  if (chkParcel) {
    chkParcel.onchange = function () {
      if (this.checked) wmsParcel.addTo(map);
      else map.removeLayer(wmsParcel);
    };
  }
  var btnOpaParcel = document.getElementById('btn-opa-parcel');
  if (btnOpaParcel) {
    btnOpaParcel.onclick = function () {
      var w = document.getElementById('opa-wrap-parcel');
      w.style.display = w.style.display === 'none' ? 'flex' : 'none';
    };
  }
  var opaParcel = document.getElementById('opa-parcel');
  if (opaParcel) {
    opaParcel.oninput = function () {
      var op = this.value / 100;
      if (wmsParcel.setOpacity) wmsParcel.setOpacity(op);
    };
  }

  /* barva pro ACI 7 (bílá/černá) podle podkladu */
  function contrast() { return baseName === 'osm' ? '#1a1a1a' : '#ffffff'; }

  /* ---------- stav ---------- */
  var datasets = [];     // {id,name,res,proj,groups:{layer:LayerGroup},items:[],visible:{}}
  var seq = 0, selected = null, selectedStyle = null;

  function colorOf(f, res) {
    if (f.rgb) return f.rgb;
    var aci = f.aci;
    if (aci === 256 || aci === undefined || aci === null) {
      var l = res.layers.filter(function (x) { return x.name === f.layer; })[0];
      aci = l ? l.aci : 7;
    }
    if (aci === 0) aci = 7;
    if (aci === 7 || aci === 255) return contrast();
    return C.aciHex(aci);
  }

  /* ---------- vykreslení ---------- */
  var labelItems = [];

  function render(ds) {
    var res = ds.res, pr = ds.proj, i, f, ll, k;
    ds.groups = {}; ds.items = [];
    var showText = window.appShowText !== false;

    for (i = 0; i < res.features.length; i++) {
      f = res.features[i];
      if (f.kind === 'text' && !showText) continue;
      var col = colorOf(f, res), lay;
      if (f.kind === 'line') {
        var pts = [], j;
        for (j = 0; j < f.coords.length; j++) { ll = pr.fwd(f.coords[j][0], f.coords[j][1]); pts.push(ll); }
        lay = L.polyline(pts, { color: col, weight: 1.4, opacity: 1, lineJoin: 'round', interactive: true });
      } else if (f.kind === 'point') {
        ll = pr.fwd(f.coords[0][0], f.coords[0][1]);
        lay = L.circleMarker(ll, { radius: 3, color: col, weight: 1.2, fillColor: col, fillOpacity: .9 });
      } else {
        ll = pr.fwd(f.coords[0][0], f.coords[0][1]);
        var deg = -(f.props['rotace'] || 0) * 180 / Math.PI;
        var span = document.createElement('span');
        span.textContent = f.props.text || '';
        span.style.color = col;
        span.style.transform = 'rotate(' + deg.toFixed(2) + 'deg)';
        span.style.fontSize = '11px';
        var div = document.createElement('div');
        div.appendChild(span);
        lay = L.marker(ll, {
          icon: L.divIcon({ className: 'cad-label', html: div.innerHTML, iconSize: null, iconAnchor: [0, 0] }),
          interactive: true, keyboard: false
        });
        labelItems.push({ marker: lay, h: f.props['výška'] || 2 });
      }
      lay._f = f; lay._ds = ds;
      lay.on('click', onPick);
      if (!ds.groups[f.layer]) ds.groups[f.layer] = L.layerGroup();
      ds.groups[f.layer].addLayer(lay);
      ds.items.push(lay);
    }
    for (k in ds.groups) if (ds.visible[k] !== false) ds.groups[k].addTo(map);
    scaleLabels();
  }

  function clearRender(ds) {
    var k;
    for (k in (ds.groups || {})) map.removeLayer(ds.groups[k]);
    labelItems = labelItems.filter(function (li) { return li.marker._ds !== ds; });
  }

  function restyleAll() {
    datasets.forEach(function (ds) {
      ds.items.forEach(function (lay) {
        var col = colorOf(lay._f, ds.res);
        if (lay === selected) return;
        if (lay.setStyle) lay.setStyle({ color: col, fillColor: col });
        else { var el = lay.getElement && lay.getElement(); if (el && el.firstChild) el.firstChild.style.color = col; }
      });
    });
  }

  function scaleLabels() {
    if (!labelItems.length) return;
    var z = map.getZoom(), lat = map.getCenter().lat;
    var mpp = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);
    for (var i = 0; i < labelItems.length; i++) {
      var el = labelItems[i].marker.getElement();
      if (!el || !el.firstChild) continue;
      var px = labelItems[i].h / mpp;
      if (px < 4) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.firstChild.style.fontSize = Math.min(px, 64).toFixed(1) + 'px';
    }
  }
  map.on('zoomend', scaleLabels);

  /* ---------- výběr a info panel ---------- */
  var justPicked = false;
  function onPick(e) {
    if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
    justPicked = true;
    setTimeout(function () { justPicked = false; }, 0);
    var lay = e.target;
    if (selected && selected !== lay) restoreSel();
    selected = lay;
    if (lay.setStyle) { selectedStyle = { color: lay.options.color, weight: lay.options.weight }; lay.setStyle({ color: '#ff3b6b', weight: 4 }); if (lay.bringToFront) lay.bringToFront(); }
    else { var el = lay.getElement(); if (el && el.firstChild) { selectedStyle = { color: el.firstChild.style.color }; el.firstChild.style.color = '#ff3b6b'; } }
    showInfo(lay._f, lay._ds);
  }
  function restoreSel() {
    if (!selected) return;
    var col = colorOf(selected._f, selected._ds.res);
    if (selected.setStyle) selected.setStyle({ color: col, weight: 1.4 });
    else { var el = selected.getElement(); if (el && el.firstChild) el.firstChild.style.color = col; }
    selected = null;
  }
  map.on('click', function () { if (justPicked) return; restoreSel(); showInfo(null); });

  function fmt(n, d) { return Number(n).toFixed(d === undefined ? 2 : d); }
  function polylineLength(f) {
    var s = 0, c = f.coords, i;
    for (i = 1; i < c.length; i++) s += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]);
    return s;
  }
  function polyArea(f) {
    var c = f.coords, s = 0, i, j;
    for (i = 0, j = c.length - 1; i < c.length; j = i++) s += (c[j][0] * c[i][1] - c[i][0] * c[j][1]);
    return Math.abs(s / 2);
  }
  function showInfo(f, ds) {
    var box = document.getElementById('info');
    if (!f) { box.innerHTML = '<p class="empty">Klikněte na objekt v mapě.</p>'; return; }
    var res = ds.res, pr = ds.proj, rows = [];
    function add(k, v, mono) { rows.push('<dt>' + k + '</dt><dd' + (mono ? ' class="val"' : '') + '>' + v + '</dd>'); }
    var col = colorOf(f, res);
    var lay = res.layers.filter(function (x) { return x.name === f.layer; })[0];
    add('Typ', f.type);
    add('Vrstva', esc(f.layer));
    var cdesc = f.props && f.props['barva DGN'] !== undefined ? 'DGN ' + f.props['barva DGN']
      : (f.aci === 256 ? 'ByLayer (' + (lay ? lay.aci : '?') + ')' : 'ACI ' + f.aci);
    add('Barva', '<span class="sw" style="display:inline-block;background:' + col + '"></span> ' + cdesc + ' · ' + col);
    if (f.handle) add('Handle', f.handle, true);
    add('Soubor', esc(ds.name));
    if (f.props.text !== undefined) add('Text', esc(String(f.props.text)));
    if (f.kind === 'line') {
      add('Délka', fmt(polylineLength(f)) + ' m', true);
      var c0 = f.coords[0], cn = f.coords[f.coords.length - 1];
      if (f.coords.length > 3 && Math.hypot(c0[0] - cn[0], c0[1] - cn[1]) < 1e-6)
        add('Plocha', fmt(polyArea(f)) + ' m²', true);
      add('Bodů', f.coords.length, true);
    }
    var p0 = f.coords[0], ll = pr.fwd(p0[0], p0[1]);
    if (pr.code === 'EPSG:5514') add('S-JTSK', 'Y ' + fmt(Math.abs(p0[0])) + '<br>X ' + fmt(Math.abs(p0[1])), true);
    else add('Souřadnice', fmt(p0[0]) + '<br>' + fmt(p0[1]), true);
    add('WGS 84', fmt(ll[0], 6) + '<br>' + fmt(ll[1], 6), true);
    var k;
    for (k in f.props) {
      if (k === 'text' || k === 'barva DGN') continue;
      var v = f.props[k];
      if (v === undefined || v === null || v === '' || (typeof v === 'object')) continue;
      if (k === 'rotace') v = fmt(v * 180 / Math.PI, 1) + '°';
      else if (typeof v === 'number') v = fmt(v, 3).replace(/\.?0+$/, '');
      add(k.charAt(0).toUpperCase() + k.slice(1), esc(String(v)));
    }
    box.innerHTML = '<dl>' + rows.join('') + '</dl>';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  /* ---------- SVG ikony typů geometrie ---------- */
  var GEO_ICONS = {
    point: function (c) { return '<svg class="gi" viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" fill="' + c + '" stroke="' + c + '" stroke-width="1.5"/></svg>'; },
    line: function (c) { return '<svg class="gi" viewBox="0 0 16 16"><line x1="2" y1="14" x2="14" y2="2" stroke="' + c + '" stroke-width="2" stroke-linecap="round"/></svg>'; },
    polyline: function (c) { return '<svg class="gi" viewBox="0 0 16 16"><polyline points="1,13 5,4 11,11 15,3" fill="none" stroke="' + c + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'; },
    polygon: function (c) { return '<svg class="gi" viewBox="0 0 16 16"><polygon points="8,1 14,6 12,14 4,14 2,6" fill="' + c + '" fill-opacity=".25" stroke="' + c + '" stroke-width="1.5" stroke-linejoin="round"/></svg>'; },
    circle: function (c) { return '<svg class="gi" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="' + c + '" stroke-width="1.8"/></svg>'; },
    arc: function (c) { return '<svg class="gi" viewBox="0 0 16 16"><path d="M3,12 A7,7 0 0,1 13,4" fill="none" stroke="' + c + '" stroke-width="1.8" stroke-linecap="round"/></svg>'; },
    ellipse: function (c) { return '<svg class="gi" viewBox="0 0 16 16"><ellipse cx="8" cy="8" rx="7" ry="4.5" fill="none" stroke="' + c + '" stroke-width="1.6" transform="rotate(-20 8 8)"/></svg>'; },
    spline: function (c) { return '<svg class="gi" viewBox="0 0 16 16"><path d="M1,12 C4,2 12,14 15,4" fill="none" stroke="' + c + '" stroke-width="1.8" stroke-linecap="round"/></svg>'; },
    text: function (c) { return '<svg class="gi" viewBox="0 0 16 16"><text x="8" y="13" text-anchor="middle" fill="' + c + '" font-family="sans-serif" font-size="13" font-weight="700">A</text></svg>'; }
  };
  var GEO_LABELS = {
    point: 'Bod', line: 'Linie', polyline: 'Polylinie', polygon: 'Polygon',
    circle: 'Kružnice', arc: 'Oblouk', ellipse: 'Elipsa', spline: 'Splajn', text: 'Text'
  };
  // Deterministic order for geometry icons
  var GEO_ORDER = ['point', 'line', 'polyline', 'polygon', 'circle', 'arc', 'ellipse', 'spline', 'text'];

  /* ---------- seznam vrstev ---------- */
  function buildLayerList() {
    var host = document.getElementById('layers');
    if (!datasets.length) { host.innerHTML = '<p class="hint">Zatím nejsou nahrána žádná data.</p>'; return; }
    host.innerHTML = '';
    datasets.forEach(function (ds) {
      var g = document.createElement('div'); g.className = 'grp';
      var h = document.createElement('p'); h.className = 'gh';
      h.textContent = ds.name + ' · ' + ds.res.features.length + ' objektů';
      g.appendChild(h);
      ds.res.layers.forEach(function (l) {
        var lb = document.createElement('label'); lb.className = 'ck';
        var cb = document.createElement('input'); cb.type = 'checkbox';
        cb.checked = ds.visible[l.name] !== false;
        cb.onchange = function () {
          ds.visible[l.name] = cb.checked;
          if (!ds.groups[l.name]) return;
          if (cb.checked) ds.groups[l.name].addTo(map); else map.removeLayer(ds.groups[l.name]);
          scaleLabels();
        };
        var sw = document.createElement('span'); sw.className = 'sw';
        var layCol = l.rgb ? l.rgb : ((l.aci === 7 || l.aci === 0) ? contrast() : C.aciHex(l.aci));
        sw.style.background = layCol;
        var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = l.name;
        /* geometry type icons */
        var gicons = document.createElement('span'); gicons.className = 'gi-wrap';
        var kinds = l.kinds || {};
        GEO_ORDER.forEach(function (gk) {
          if (!kinds[gk]) return;
          var ic = document.createElement('span'); ic.className = 'gi-badge';
          ic.title = (GEO_LABELS[gk] || gk) + ' (' + kinds[gk] + ')';
          ic.innerHTML = GEO_ICONS[gk] ? GEO_ICONS[gk](layCol) : '';
          gicons.appendChild(ic);
        });
        var cnt = document.createElement('span'); cnt.className = 'cnt'; cnt.textContent = l.count;
        lb.appendChild(cb); lb.appendChild(sw); lb.appendChild(nm); lb.appendChild(gicons); lb.appendChild(cnt);
        lb.dataset.name = l.name.toLowerCase();
        g.appendChild(lb);
      });
      host.appendChild(g);
    });
  }
  document.getElementById('allon').onclick = function () { toggleAll(true); };
  document.getElementById('alloff').onclick = function () { toggleAll(false); };
  function toggleAll(on) {
    datasets.forEach(function (ds) {
      ds.res.layers.forEach(function (l) {
        ds.visible[l.name] = on;
        if (!ds.groups[l.name]) return;
        if (on) ds.groups[l.name].addTo(map); else map.removeLayer(ds.groups[l.name]);
      });
    });
    buildLayerList(); scaleLabels();
  }
  window.appShowText = true;
  var toggleTextBtn = document.getElementById('toggle-text');
  if (toggleTextBtn) {
    toggleTextBtn.onclick = function () {
      window.appShowText = !window.appShowText;
      this.classList.toggle('off', !window.appShowText);
      this.title = window.appShowText ? "Vykreslovat texty (zapnuto)" : "Vykreslovat texty (vypnuto)";
      redrawAll();
    };
  }

  document.getElementById('zoom').onclick = function () { zoomToData(); };

  document.getElementById('layerfilter').oninput = function () {
    var term = this.value.toLowerCase();
    var grps = document.querySelectorAll('.grp');
    for (var i = 0; i < grps.length; i++) {
      var lbls = grps[i].querySelectorAll('label.ck');
      var anyVis = false;
      for (var j = 0; j < lbls.length; j++) {
        var match = !term || lbls[j].dataset.name.indexOf(term) >= 0;
        lbls[j].style.display = match ? '' : 'none';
        if (match) anyVis = true;
      }
      grps[i].style.display = anyVis ? '' : 'none';
    }
  };

  /* ---------- toggle UI sekcí ---------- */
  document.querySelectorAll('.sec > .t').forEach(function (t) {
    t.onclick = function () {
      this.parentElement.classList.toggle('collapsed');
    };
  });
  var btnOpa = document.getElementById('btn-opa');
  if (btnOpa) {
    btnOpa.onclick = function () {
      var w = document.getElementById('opa-wrap');
      w.style.display = w.style.display === 'none' ? 'flex' : 'none';
      this.classList.toggle('active');
    };
  }
  var btnFlt = document.getElementById('btn-filter');
  if (btnFlt) {
    btnFlt.onclick = function () {
      var w = document.getElementById('filter-wrap');
      w.style.display = w.style.display === 'none' ? 'block' : 'none';
      this.classList.toggle('active');
      if (w.style.display === 'block') document.getElementById('layerfilter').focus();
    };
  }

  function zoomToData() {
    var b = null;
    datasets.forEach(function (ds) {
      var bb = ds.res.bbox, pr = ds.proj;
      if (!isFinite(bb[0])) return;
      var corners = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]].map(function (p) { return pr.fwd(p[0], p[1]); });
      var lb = L.latLngBounds(corners);
      b = b ? b.extend(lb) : lb;
    });
    if (b) map.fitBounds(b, { padding: [24, 24], maxZoom: 21 });
  }

  /* ---------- soubory ---------- */
  var fileRows = [];
  function renderFiles() {
    var host = document.getElementById('files');
    host.innerHTML = '';
    fileRows.forEach(function (r) {
      var d = document.createElement('div'); d.className = 'file' + (r.bad ? ' bad' : '');
      var n = document.createElement('div'); n.className = 'n';
      var b = document.createElement('b'); b.textContent = r.name;
      n.appendChild(b);
      if (!r.bad) {
        var x = document.createElement('button'); x.className = 'x'; x.title = 'Odebrat'; x.innerHTML = '&times;';
        x.onclick = function () { removeDataset(r.id); };
        n.appendChild(x);
      }
      var m = document.createElement('div'); m.className = 'm'; m.textContent = r.msg;
      d.appendChild(n); d.appendChild(m); host.appendChild(d);
    });
  }
  function removeDataset(id) {
    var ds = datasets.filter(function (d) { return d.id === id; })[0];
    if (ds) { clearRender(ds); datasets = datasets.filter(function (d) { return d !== ds; }); }
    fileRows = fileRows.filter(function (r) { return r.id !== id; });
    restoreSel(); showInfo(null); renderFiles(); buildLayerList(); updateCrsInfo();
  }

  var libre = null;
  async function getLibre() {
    if (!libre) {
      var mod = await import('https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.7.10/dist/libredwg-web.js');
      libre = { mod: mod, inst: await mod.LibreDwg.create() };
    }
    return libre;
  }

  function decodeDxf(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { }
    var head = new TextDecoder('windows-1252').decode(buf.slice(0, 8192));
    var m = /\$DWGCODEPAGE[\s\S]{0,12}?\n\s*([A-Za-z0-9_]+)/.exec(head);
    var enc = 'windows-1250';
    if (m) {
      var cp = m[1].toUpperCase();
      if (cp.indexOf('1252') > 0) enc = 'windows-1252';
      else if (cp.indexOf('852') > 0) enc = 'ibm866';
      else if (cp.indexOf('1251') > 0) enc = 'windows-1251';
    }
    try { return new TextDecoder(enc).decode(buf); }
    catch (e) { return new TextDecoder('windows-1250').decode(buf); }
  }

  async function loadFiles(list) {
    for (var i = 0; i < list.length; i++) await loadOne(list[i]);
  }
  async function loadOne(file) {
    var id = ++seq, ext = (file.name.split('.').pop() || '').toLowerCase();
    var row = { id: id, name: file.name, msg: 'Načítám…', bad: false };
    fileRows.push(row); renderFiles();
    try {
      var res;
      if (ext === 'dgn') {
        row.msg = 'Čtu DGN…'; renderFiles();
        var abd = await file.arrayBuffer();
        res = await window.CadDgn.parseDgn(abd, file.name, C);
      } else if (ext === 'dwg') {
        row.msg = 'Načítám knihovnu pro DWG (~10 MB)…'; renderFiles();
        var lib = await getLibre();
        var ab = await file.arrayBuffer();
        var dwg = lib.inst.dwg_read_data(ab, lib.mod.Dwg_File_Type.DWG);
        var db = lib.inst.convert(dwg);
        try { lib.inst.dwg_free(dwg); } catch (e) { }
        res = C.normalizeDwg(db, file.name);
      } else if (ext === 'dxf') {
        var buf = await file.arrayBuffer();
        var P = window.DxfParser && (window.DxfParser.default || window.DxfParser);
        var dxf = new P().parseSync(decodeDxf(buf));
        res = C.normalizeDxf(dxf, file.name);
      } else {
        row.bad = true; row.msg = 'Nepodporovaný formát (DWG a DXF).'; renderFiles(); return;
      }
      if (!res.features.length) { row.bad = true; row.msg = 'Soubor neobsahuje kreslitelné prvky.'; renderFiles(); return; }
      var pr = makeProjector(document.getElementById('crs').value, res.bbox);
      if (!pr) {
        row.bad = true;
        row.msg = 'Souřadnice nelze zařadit do žádného systému – vyberte systém ručně.';
        renderFiles(); return;
      }
      var ds = { id: id, name: file.name, res: res, proj: pr, groups: {}, items: [], visible: {} };
      datasets.push(ds);
      render(ds);
      var sk = Object.keys(res.skipped);
      row.msg = res.features.length + ' objektů · ' + res.layers.length + ' vrstev' +
        (res.info && res.info.is3d ? ' · 3D' : '') +
        (sk.length ? ' · nevykresleno: ' + sk.join(', ') : '');
      renderFiles(); buildLayerList(); updateCrsInfo(); zoomToData();
    } catch (err) {
      row.bad = true; row.msg = 'Chyba: ' + (err && err.message ? err.message : err);
      renderFiles();
      console.error(err);
    }
  }

  function redrawAll() {
    var keep = datasets.slice();
    keep.forEach(function (ds) { clearRender(ds); ds.groups = {}; ds.items = []; render(ds); });
    restoreSel();
  }
  function updateCrsInfo() {
    var el = document.getElementById('crsinfo');
    if (!datasets.length) { el.textContent = 'Zjistí se z rozsahu souřadnic po nahrání dat.'; return; }
    var pr = datasets[datasets.length - 1].proj;
    el.textContent = (pr.auto ? 'Rozpoznáno: ' : 'Nastaveno: ') + (CRS_LABEL[pr.code] || pr.code) +
      (pr.negate ? ' (kladné souřadnice převedeny)' : '') + (pr.swap ? ' (prohozené osy)' : '');
  }
  document.getElementById('crs').onchange = function () {
    var mode = this.value;
    datasets.forEach(function (ds) {
      var pr = makeProjector(mode, ds.res.bbox);
      if (!pr) return;
      clearRender(ds); ds.proj = pr; ds.groups = {}; ds.items = []; render(ds);
    });
    updateCrsInfo(); zoomToData();
  };

  /* ---------- vstupy ---------- */
  var drop = document.getElementById('drop'), fin = document.getElementById('fin');
  drop.onclick = function () { fin.click(); };
  drop.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fin.click(); } };
  fin.onchange = function () { loadFiles(this.files); this.value = ''; };
  ['dragenter', 'dragover'].forEach(function (t) {
    window.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    window.addEventListener(t, function (e) { e.preventDefault(); if (t === 'dragleave' && e.relatedTarget) return; drop.classList.remove('over'); });
  });
  window.addEventListener('drop', function (e) {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
  });

  /* ---------- odečet souřadnic ---------- */
  var cel = document.getElementById('coords');
  map.on('mousemove', function (e) {
    var jt = proj4('EPSG:4326', 'EPSG:5514', [e.latlng.lng, e.latlng.lat]);
    cel.innerHTML = 'JTSK&nbsp; Y ' + fmt(Math.abs(jt[0])) + '&nbsp; X ' + fmt(Math.abs(jt[1])) +
      '<br>WGS&nbsp;&nbsp; ' + fmt(e.latlng.lat, 6) + ', ' + fmt(e.latlng.lng, 6);
  });
  map.on('mouseout', function () { cel.textContent = '—'; });

  /* pro ladění z konzole prohlížeče */
  window.CadViewer = { map: map, load: loadFiles, datasets: function () { return datasets; } };
})();
