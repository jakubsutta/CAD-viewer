/* ---------------------------------------------------------------
   cad-export-shp.js – Export CAD vrstev a úrovní do ESRI Shapefile (SHP).
   Podporuje body, linie, polygony a texty, včetně atributů (DBF),
   souřadnicových systémů (.prj), kódování UTF-8 (.cpg) a zabalení do ZIP.
   Čistý JavaScript bez externích knihoven.
   --------------------------------------------------------------- */
(function (root) {
  'use strict';

  /* --- WKT definice souřadnicových systémů --- */
  var WKT_CRS = {
    'EPSG:5514': 'PROJCS["S-JTSK_Krovak_East_North",GEOGCS["GCS_S_JTSK",DATUM["D_S_JTSK",SPHEROID["Bessel_1841",6377397.155,299.1528128]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Krovak"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Pseudo_Standard_Parallel_1",78.5],PARAMETER["Scale_Factor",0.9999],PARAMETER["Azimuth",30.28813975277778],PARAMETER["Longitude_Of_Center",24.83333333333333],PARAMETER["Latitude_Of_Center",49.5],PARAMETER["X_Scale",-1.0],PARAMETER["Y_Scale",1.0],PARAMETER["XY_Plane_Rotation",90.0],UNIT["Meter",1.0],AUTHORITY["EPSG","5514"]]',
    'EPSG:4326': 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]',
    'EPSG:32633': 'PROJCS["WGS_1984_UTM_Zone_33N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",15.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0],AUTHORITY["EPSG","32633"]]',
    'EPSG:3857': 'PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Mercator_Auxiliary_Sphere"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",0.0],PARAMETER["Standard_Parallel_1",0.0],PARAMETER["Auxiliary_Sphere_Type",0.0],UNIT["Meter",1.0],AUTHORITY["EPSG","3857"]]'
  };

  /* --- Definice polí v DBF tabulce --- */
  var DBF_FIELDS = [
    { name: 'ID', type: 'N', length: 10, dec: 0 },
    { name: 'TYPE', type: 'C', length: 20, dec: 0 },
    { name: 'LAYER', type: 'C', length: 50, dec: 0 },
    { name: 'LEVEL', type: 'N', length: 6, dec: 0 },
    { name: 'HANDLE', type: 'C', length: 16, dec: 0 },
    { name: 'COLOR', type: 'C', length: 10, dec: 0 },
    { name: 'TEXT', type: 'C', length: 150, dec: 0 },
    { name: 'HEIGHT', type: 'N', length: 10, dec: 3 },
    { name: 'ROTATION', type: 'N', length: 10, dec: 2 },
    { name: 'LENGTH', type: 'N', length: 14, dec: 3 },
    { name: 'AREA', type: 'N', length: 14, dec: 3 },
    { name: 'CELL', type: 'C', length: 40, dec: 0 },
    { name: 'WEIGHT', type: 'N', length: 6, dec: 0 }
  ];

  /* --- CRC-32 tabulka pro ZIP --- */
  var crcTable = (function () {
    var c, table = new Uint32Array(256), n, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) {
        c = ((c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1));
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(buf) {
    var c = 0xffffffff, i;
    for (i = 0; i < buf.length; i++) {
      c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 0xff];
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  /* --- Tvorba ZIP archivu (metoda Store, bez externích závislostí) --- */
  function createZip(files) {
    var now = new Date();
    var time = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
    var date = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

    var enc = new TextEncoder();
    var localHeaders = [];
    var centralHeaders = [];
    var offset = 0, i;

    for (i = 0; i < files.length; i++) {
      var file = files[i];
      var nameBytes = enc.encode(file.name);
      var data = file.data;
      var crc = crc32(data);
      var size = data.length;

      // Local header (30 B + název)
      var lh = new Uint8Array(30 + nameBytes.length);
      var ldv = new DataView(lh.buffer);
      ldv.setUint32(0, 0x04034b50, true);
      ldv.setUint16(4, 20, true);
      ldv.setUint16(6, 0x0800, true);       // bit 11 = UTF-8 název souboru
      ldv.setUint16(8, 0, true);            // Store (bez komprese)
      ldv.setUint16(10, time, true);
      ldv.setUint16(12, date, true);
      ldv.setUint32(14, crc, true);
      ldv.setUint32(18, size, true);
      ldv.setUint32(22, size, true);
      ldv.setUint16(26, nameBytes.length, true);
      ldv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);

      localHeaders.push({ header: lh, data: data, offset: offset });

      // Central directory header (46 B + název)
      var cd = new Uint8Array(46 + nameBytes.length);
      var cdv = new DataView(cd.buffer);
      cdv.setUint32(0, 0x02014b50, true);
      cdv.setUint16(4, 0x0314, true);       // UNIX 2.0
      cdv.setUint16(6, 20, true);
      cdv.setUint16(8, 0x0800, true);       // UTF-8
      cdv.setUint16(10, 0, true);
      cdv.setUint16(12, time, true);
      cdv.setUint16(14, date, true);
      cdv.setUint32(16, crc, true);
      cdv.setUint32(20, size, true);
      cdv.setUint32(24, size, true);
      cdv.setUint16(28, nameBytes.length, true);
      cdv.setUint16(30, 0, true);
      cdv.setUint16(32, 0, true);
      cdv.setUint16(34, 0, true);
      cdv.setUint16(36, 0, true);
      cdv.setUint32(38, 0, true);
      cdv.setUint32(42, offset, true);
      cd.set(nameBytes, 46);

      centralHeaders.push(cd);
      offset += lh.length + size;
    }

    var centralOffset = offset;
    var centralSize = 0;
    for (i = 0; i < centralHeaders.length; i++) {
      centralSize += centralHeaders[i].length;
    }

    // End of central directory record (22 B)
    var eocd = new Uint8Array(22);
    var edv = new DataView(eocd.buffer);
    edv.setUint32(0, 0x06054b50, true);
    edv.setUint16(4, 0, true);
    edv.setUint16(6, 0, true);
    edv.setUint16(8, files.length, true);
    edv.setUint16(10, files.length, true);
    edv.setUint32(12, centralSize, true);
    edv.setUint32(16, centralOffset, true);
    edv.setUint16(20, 0, true);

    var totalLength = centralOffset + centralSize + 22;
    var out = new Uint8Array(totalLength);
    var pos = 0;
    for (i = 0; i < localHeaders.length; i++) {
      out.set(localHeaders[i].header, pos);
      pos += localHeaders[i].header.length;
      out.set(localHeaders[i].data, pos);
      pos += localHeaders[i].data.length;
    }
    for (i = 0; i < centralHeaders.length; i++) {
      out.set(centralHeaders[i], pos);
      pos += centralHeaders[i].length;
    }
    out.set(eocd, pos);
    return out;
  }

  /* --- Pomocné funkce pro DBF a text --- */
  function fitStringUtf8(str, maxBytes) {
    if (str === undefined || str === null) return new Uint8Array(0);
    var enc = new TextEncoder();
    var b = enc.encode(String(str));
    if (b.length <= maxBytes) return b;
    var s = String(str);
    while (s.length > 0) {
      s = s.slice(0, -1);
      b = enc.encode(s);
      if (b.length <= maxBytes) return b;
    }
    return new Uint8Array(0);
  }

  function fitNumeric(val, length, dec) {
    if (val === null || val === undefined || isNaN(val)) {
      return ' '.repeat(length);
    }
    var s = (dec > 0) ? Number(val).toFixed(dec) : String(Math.round(val));
    if (s.length > length) s = s.slice(0, length);
    return s.padStart(length, ' ');
  }

  function writeDbf(records) {
    var now = new Date();
    var numRecords = records.length;
    var numFields = DBF_FIELDS.length;
    var headerLen = 32 + 32 * numFields + 1;
    var recLen = 1, i;
    for (i = 0; i < numFields; i++) recLen += DBF_FIELDS[i].length;

    var totalLen = headerLen + numRecords * recLen + 1;
    var buf = new Uint8Array(totalLen);
    var dv = new DataView(buf.buffer);

    buf[0] = 0x03; // dBase III
    buf[1] = (now.getFullYear() - 1900) & 0xff;
    buf[2] = (now.getMonth() + 1) & 0xff;
    buf[3] = now.getDate() & 0xff;
    dv.setUint32(4, numRecords, true);
    dv.setUint16(8, headerLen, true);
    dv.setUint16(10, recLen, true);

    var enc = new TextEncoder();
    var fpos = 32;
    for (i = 0; i < numFields; i++) {
      var f = DBF_FIELDS[i];
      var nameBytes = enc.encode(f.name);
      buf.set(nameBytes.subarray(0, 10), fpos);
      buf[fpos + 11] = f.type.charCodeAt(0);
      buf[fpos + 16] = f.length;
      buf[fpos + 17] = f.dec;
      fpos += 32;
    }
    buf[fpos] = 0x0d; // konec hlavičky polí

    var rpos = headerLen, r, k;
    for (r = 0; r < numRecords; r++) {
      var rec = records[r];
      buf[rpos++] = 0x20; // platný záznam
      for (i = 0; i < numFields; i++) {
        var field = DBF_FIELDS[i];
        var val = rec[field.name];
        if (field.type === 'C') {
          var strBytes = fitStringUtf8(val, field.length);
          buf.set(strBytes, rpos);
          for (k = strBytes.length; k < field.length; k++) {
            buf[rpos + k] = 0x20;
          }
        } else {
          var numStr = fitNumeric(val, field.length, field.dec);
          var nb = enc.encode(numStr);
          buf.set(nb.subarray(0, field.length), rpos);
        }
        rpos += field.length;
      }
    }
    buf[rpos] = 0x1a; // EOF
    return buf;
  }

  /* --- Zápis bodového SHP a SHX (Shape Type 1) --- */
  function writePointShpAndShx(features) {
    var numRecs = features.length;
    var xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity, i;
    for (i = 0; i < numRecs; i++) {
      var p = features[i];
      if (p.x < xmin) xmin = p.x; if (p.y < ymin) ymin = p.y;
      if (p.x > xmax) xmax = p.x; if (p.y > ymax) ymax = p.y;
    }
    if (!numRecs) { xmin = ymin = xmax = ymax = 0; }

    var shpLen = 100 + numRecs * 28;
    var shxLen = 100 + numRecs * 8;

    var shpBuf = new Uint8Array(shpLen);
    var shpDv = new DataView(shpBuf.buffer);
    var shxBuf = new Uint8Array(shxLen);
    var shxDv = new DataView(shxBuf.buffer);

    function writeHeader(dv, lenInWords) {
      dv.setUint32(0, 9994, false);
      dv.setUint32(24, lenInWords, false);
      dv.setUint32(28, 1000, true);
      dv.setUint32(32, 1, true); // Point
      dv.setFloat64(36, xmin, true);
      dv.setFloat64(44, ymin, true);
      dv.setFloat64(52, xmax, true);
      dv.setFloat64(60, ymax, true);
    }

    writeHeader(shpDv, shpLen / 2);
    writeHeader(shxDv, shxLen / 2);

    var shpPos = 100, shxPos = 100;
    for (i = 0; i < numRecs; i++) {
      var pt = features[i];
      var offsetWords = shpPos / 2;
      var contentLenWords = 10;

      shpDv.setUint32(shpPos, i + 1, false);
      shpDv.setUint32(shpPos + 4, contentLenWords, false);

      shpDv.setUint32(shpPos + 8, 1, true);
      shpDv.setFloat64(shpPos + 12, pt.x, true);
      shpDv.setFloat64(shpPos + 20, pt.y, true);

      shxDv.setUint32(shxPos, offsetWords, false);
      shxDv.setUint32(shxPos + 4, contentLenWords, false);

      shpPos += 28;
      shxPos += 8;
    }

    return { shp: shpBuf, shx: shxBuf };
  }

  /* --- Zápis liniového (Type 3) nebo polygonového (Type 5) SHP a SHX --- */
  function writePolyShpAndShx(features, isPolygon) {
    var shapeType = isPolygon ? 5 : 3;
    var numRecs = features.length;
    var totalContentBytes = 0;
    var xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity, i, k;

    var processed = [];
    for (i = 0; i < numRecs; i++) {
      var pts = features[i].pts;
      if (!pts || pts.length < 2) continue;
      if (isPolygon) {
        if (pts.length < 3) continue;
        var first = pts[0], last = pts[pts.length - 1];
        if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 1e-7) {
          pts = pts.concat([first]);
        }
        var area = 0;
        for (k = 0; k < pts.length - 1; k++) {
          area += (pts[k + 1][0] - pts[k][0]) * (pts[k + 1][1] + pts[k][1]);
        }
        if (area < 0) pts = pts.slice().reverse(); // po směru hodinových ručiček pro vnější okruh
      }
      var rxmin = Infinity, rymin = Infinity, rxmax = -Infinity, rymax = -Infinity;
      for (k = 0; k < pts.length; k++) {
        var x = pts[k][0], y = pts[k][1];
        if (x < rxmin) rxmin = x; if (y < rymin) rymin = y;
        if (x > rxmax) rxmax = x; if (y > rymax) rymax = y;
      }
      if (rxmin < xmin) xmin = rxmin; if (rymin < ymin) ymin = rymin;
      if (rxmax > xmax) xmax = rxmax; if (rymax > ymax) ymax = rymax;

      var contentBytes = 48 + 16 * pts.length;
      processed.push({ pts: pts, box: [rxmin, rymin, rxmax, rymax], contentBytes: contentBytes, origIdx: i });
      totalContentBytes += 8 + contentBytes;
    }

    if (!processed.length) { xmin = ymin = xmax = ymax = 0; }

    var shpLen = 100 + totalContentBytes;
    var shxLen = 100 + processed.length * 8;

    var shpBuf = new Uint8Array(shpLen);
    var shpDv = new DataView(shpBuf.buffer);
    var shxBuf = new Uint8Array(shxLen);
    var shxDv = new DataView(shxBuf.buffer);

    function writeHeader(dv, lenInWords) {
      dv.setUint32(0, 9994, false);
      dv.setUint32(24, lenInWords, false);
      dv.setUint32(28, 1000, true);
      dv.setUint32(32, shapeType, true);
      dv.setFloat64(36, xmin, true);
      dv.setFloat64(44, ymin, true);
      dv.setFloat64(52, xmax, true);
      dv.setFloat64(60, ymax, true);
    }

    writeHeader(shpDv, shpLen / 2);
    writeHeader(shxDv, shxLen / 2);

    var shpPos = 100, shxPos = 100;
    for (i = 0; i < processed.length; i++) {
      var item = processed[i];
      var offsetWords = shpPos / 2;
      var contentLenWords = item.contentBytes / 2;

      shpDv.setUint32(shpPos, i + 1, false);
      shpDv.setUint32(shpPos + 4, contentLenWords, false);

      shpDv.setUint32(shpPos + 8, shapeType, true);
      shpDv.setFloat64(shpPos + 12, item.box[0], true);
      shpDv.setFloat64(shpPos + 20, item.box[1], true);
      shpDv.setFloat64(shpPos + 28, item.box[2], true);
      shpDv.setFloat64(shpPos + 36, item.box[3], true);
      shpDv.setUint32(shpPos + 44, 1, true); // 1 část
      shpDv.setUint32(shpPos + 48, item.pts.length, true);
      shpDv.setUint32(shpPos + 52, 0, true);

      var ppos = shpPos + 56;
      for (k = 0; k < item.pts.length; k++) {
        shpDv.setFloat64(ppos, item.pts[k][0], true);
        shpDv.setFloat64(ppos + 8, item.pts[k][1], true);
        ppos += 16;
      }

      shxDv.setUint32(shxPos, offsetWords, false);
      shxDv.setUint32(shxPos + 4, contentLenWords, false);

      shpPos += 8 + item.contentBytes;
      shxPos += 8;
    }

    return { shp: shpBuf, shx: shxBuf, processed: processed };
  }

  /* --- Převod souřadnic CAD -> cílový CRS --- */
  function transformCoord(x, y, ds, targetCrs) {
    var pr = ds.proj;
    if (targetCrs === 'EPSG:4326') {
      var ll = pr.fwd(x, y); // [lat, lon]
      return [ll[1], ll[0]]; // [lon, lat] pro Shapefile
    }
    // Výchozí nebo nativní CRS projektu (např. EPSG:5514 / EPSG:32633 / EPSG:3857)
    var a = x, b = y;
    if (pr.swap) { var t = a; a = b; b = t; }
    if (pr.negate) { a = -Math.abs(a); b = -Math.abs(b); }
    return [a, b];
  }

  function calcLength(coords) {
    var s = 0, i;
    for (i = 1; i < coords.length; i++) s += Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]);
    return s;
  }

  function calcArea(coords) {
    var s = 0, i, j;
    for (i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      s += (coords[j][0] * coords[i][1] - coords[i][0] * coords[j][1]);
    }
    return Math.abs(s / 2);
  }

  function sanitizeFilename(name) {
    if (!name) return 'vrstva';
    return String(name).replace(/[/\\?%*:|"<>]/g, '_').trim() || 'vrstva';
  }

  /* --- Sestavení SHP balíčku pro dané prvky --- */
  function buildShapefileFiles(features, baseName, ds, targetCrs) {
    var crsCode = (targetCrs === 'EPSG:4326') ? 'EPSG:4326' : (ds.proj.code || 'EPSG:5514');
    var prjText = WKT_CRS[crsCode] || WKT_CRS['EPSG:5514'];
    var enc = new TextEncoder();
    var prjBytes = enc.encode(prjText);
    var cpgBytes = enc.encode('UTF-8');

    // Rozdělení prvků podle geometrického typu
    var groups = {
      point: { features: [], records: [] },
      text: { features: [], records: [] },
      polygon: { features: [], records: [] },
      line: { features: [], records: [] }
    };

    var i, j;
    for (i = 0; i < features.length; i++) {
      var f = features[i];
      var p0 = f.coords[0] || [0, 0];
      var props = f.props || {};

      var len = 0, area = 0;
      if (f.kind === 'line') {
        len = calcLength(f.coords);
        if (f.coords.length >= 4) area = calcArea(f.coords);
      }

      var rec = {
        ID: f.id !== undefined ? f.id + 1 : (i + 1),
        TYPE: f.type || '',
        LAYER: f.layer || '',
        LEVEL: props['úroveň'] !== undefined ? props['úroveň'] : 0,
        HANDLE: f.handle ? String(f.handle) : '',
        COLOR: f.rgb || (f.aci ? ('ACI ' + f.aci) : ''),
        TEXT: props.text ? String(props.text) : '',
        HEIGHT: props['výška'] || 0,
        ROTATION: props['rotace'] ? Number((props['rotace'] * 180 / Math.PI).toFixed(2)) : 0,
        LENGTH: Number(len.toFixed(3)),
        AREA: Number(area.toFixed(3)),
        CELL: props['buňka'] ? String(props['buňka']) : '',
        WEIGHT: props['tloušťka'] || 0
      };

      if (f.kind === 'text') {
        var tpt = transformCoord(p0[0], p0[1], ds, targetCrs);
        groups.text.features.push({ x: tpt[0], y: tpt[1] });
        groups.text.records.push(rec);
      } else if (f.kind === 'point') {
        var ppt = transformCoord(p0[0], p0[1], ds, targetCrs);
        groups.point.features.push({ x: ppt[0], y: ppt[1] });
        groups.point.records.push(rec);
      } else {
        // Linie nebo polygon
        var tpts = [];
        for (j = 0; j < f.coords.length; j++) {
          tpts.push(transformCoord(f.coords[j][0], f.coords[j][1], ds, targetCrs));
        }
        var isPoly = (props['uzavřený'] === 'ano' || f.type === 'SHAPE' || f.type === 'SOLID' || f.type === '3DFACE');
        if (isPoly && tpts.length >= 3) {
          groups.polygon.features.push({ pts: tpts });
          groups.polygon.records.push(rec);
        } else {
          groups.line.features.push({ pts: tpts });
          groups.line.records.push(rec);
        }
      }
    }

    // Určení, které typy mají data
    var activeTypes = [];
    ['line', 'polygon', 'point', 'text'].forEach(function (gt) {
      if (groups[gt].features.length > 0) activeTypes.push(gt);
    });

    var files = [];
    activeTypes.forEach(function (gt) {
      // Pokud je přítomen jen 1 typ geometrie, použijeme přímo baseName; pokud více, přidáme příponu typu
      var subName = (activeTypes.length === 1) ? baseName : (baseName + '_' + gt);
      var g = groups[gt];
      var shpRes;

      if (gt === 'point' || gt === 'text') {
        shpRes = writePointShpAndShx(g.features);
        files.push({ name: subName + '.shp', data: shpRes.shp });
        files.push({ name: subName + '.shx', data: shpRes.shx });
        files.push({ name: subName + '.dbf', data: writeDbf(g.records) });
      } else if (gt === 'line') {
        shpRes = writePolyShpAndShx(g.features, false);
        var lineRecs = shpRes.processed.map(function (p) { return g.records[p.origIdx]; });
        files.push({ name: subName + '.shp', data: shpRes.shp });
        files.push({ name: subName + '.shx', data: shpRes.shx });
        files.push({ name: subName + '.dbf', data: writeDbf(lineRecs) });
      } else if (gt === 'polygon') {
        shpRes = writePolyShpAndShx(g.features, true);
        var polyRecs = shpRes.processed.map(function (p) { return g.records[p.origIdx]; });
        files.push({ name: subName + '.shp', data: shpRes.shp });
        files.push({ name: subName + '.shx', data: shpRes.shx });
        files.push({ name: subName + '.dbf', data: writeDbf(polyRecs) });
      }

      files.push({ name: subName + '.prj', data: prjBytes });
      files.push({ name: subName + '.cpg', data: cpgBytes });
    });

    return files;
  }

  /* --- Spuštění stažení v prohlížeči --- */
  function downloadZip(zipBytes, filename) {
    var blob = new Blob([zipBytes], { type: 'application/zip' });
    if (typeof window !== 'undefined' && window.document) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1000);
    }
    return blob;
  }

  /* --- Export jedné úrovně / vrstvy --- */
  function exportLayerToShp(ds, layerName, options) {
    options = options || {};
    var targetCrs = options.crs || 'project';
    var feats = ds.res.features.filter(function (f) { return f.layer === layerName; });
    if (!feats.length) {
      alert('Úroveň "' + layerName + '" neobsahuje žádné exportovatelné objekty.');
      return null;
    }

    var dsBase = sanitizeFilename(ds.name.replace(/\.[^/.]+$/, ''));
    var layBase = sanitizeFilename(layerName);
    var shpBaseName = layBase;
    var zipName = dsBase + '_' + layBase + '_shp.zip';

    var files = buildShapefileFiles(feats, shpBaseName, ds, targetCrs);
    if (!files.length) {
      alert('Pro úroveň "' + layerName + '" se nepodařilo vytvořit žádnou geometrii.');
      return null;
    }

    var zipBytes = createZip(files);
    downloadZip(zipBytes, zipName);
    return { zipBytes: zipBytes, filesCount: files.length, featuresCount: feats.length };
  }

  /* --- Export celého souboru nebo vybraných úrovní --- */
  function exportDatasetToShp(ds, options) {
    options = options || {};
    var targetCrs = options.crs || 'project';
    var selectedLayers = options.layers; // pole názvů vrstev nebo null pro všechny

    var featsByLayer = {};
    ds.res.features.forEach(function (f) {
      if (selectedLayers && selectedLayers.indexOf(f.layer) === -1) return;
      if (!featsByLayer[f.layer]) featsByLayer[f.layer] = [];
      featsByLayer[f.layer].push(f);
    });

    var layerNames = Object.keys(featsByLayer);
    if (!layerNames.length) {
      alert('Nebyly nalezeny žádné objekty k exportu.');
      return null;
    }

    var allFiles = [];
    layerNames.forEach(function (lay) {
      var layFeats = featsByLayer[lay];
      var layBase = sanitizeFilename(lay);
      var files = buildShapefileFiles(layFeats, layBase, ds, targetCrs);
      allFiles = allFiles.concat(files);
    });

    if (!allFiles.length) {
      alert('Nepodařilo se vytvořit žádné SHP soubory.');
      return null;
    }

    var dsBase = sanitizeFilename(ds.name.replace(/\.[^/.]+$/, ''));
    var zipName = dsBase + '_shp.zip';
    var zipBytes = createZip(allFiles);
    downloadZip(zipBytes, zipName);
    return { zipBytes: zipBytes, filesCount: allFiles.length, layersCount: layerNames.length };
  }

  var api = {
    exportLayerToShp: exportLayerToShp,
    exportDatasetToShp: exportDatasetToShp,
    buildShapefileFiles: buildShapefileFiles,
    createZip: createZip,
    writePointShpAndShx: writePointShpAndShx,
    writePolyShpAndShx: writePolyShpAndShx,
    writeDbf: writeDbf,
    WKT_CRS: WKT_CRS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CadExportShp = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
