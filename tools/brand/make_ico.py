import struct, sys
pngs = [open(f, 'rb').read() for f in sys.argv[2:]]
sizes = [16, 32, 48]
hdr = struct.pack('<HHH', 0, 1, len(pngs)); off = 6 + 16 * len(pngs); ents = b''
for s, d in zip(sizes, pngs):
    ents += struct.pack('<BBBBHHII', s, s, 0, 0, 1, 32, len(d), off); off += len(d)
open(sys.argv[1], 'wb').write(hdr + ents + b''.join(pngs))
