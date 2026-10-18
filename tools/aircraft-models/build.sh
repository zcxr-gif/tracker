#!/bin/sh
# Rebuilds models/fleet/*.glb from FlightGear sources, as committed.
#
#   FG=/path/to/checkouts sh build.sh
#
# $FG holds a checkout of each repository named in models/fleet/CREDITS.md,
# under the repository's own name (737-800YV, 747-400, 777, 787-9, A320-family,
# A330-300, CRJ700-family, E-jet-family, MD-11). Only the .ac and .xml files
# are read. The A380 is not built here (see CREDITS.md).
set -e
cd "$(dirname "$0")"
: "${FG:?set FG to the folder of FlightGear checkouts}"
OUT=${OUT:-../../models/fleet}
TMP=$(mktemp -d)
one() { # file, then what ac2glb.mjs takes
    f=$1; shift
    node ac2glb.mjs "$TMP/$f" "$@"
    node pack.mjs "$TMP/$f" "$OUT/$f"
}
one 737.glb "$FG/737-800YV/Models/737-800.xml::$FG/737-800YV"
one 747.glb "$FG/747-400/Models/747-400.xml::$FG/747-400"
# The 777's gear doors are modelled open.
SKIP_EXTRA='ramdoor|geardoor' one 777-200er.glb "$FG/777/Models/777-200ER.ac"
SKIP_EXTRA='ramdoor|geardoor' one 777-300er.glb "$FG/777/Models/777-300ER.ac"
one 787.glb "$FG/787-9/Models/787-9.ac"
one a320.glb "$FG/A320-family/Models/A320-200-CFM.xml::$FG/A320-family"
one a330.glb "$FG/A330-300/Models/A330-303.xml::$FG/A330-300"
one crj700.glb "$FG/CRJ700-family/Models/CRJ700.xml::$FG/CRJ700-family"
one crj900.glb "$FG/CRJ700-family/Models/CRJ900.xml::$FG/CRJ700-family"
# The E-Jets carry a box for a cabin, which would show through their windows.
SKIP_EXTRA='^box$' one e175.glb "$FG/E-jet-family/Models/erj175.ac"
SKIP_EXTRA='^box$' one e190.glb "$FG/E-jet-family/Models/erj190.ac"
one md11.glb "$FG/MD-11/Models/MD-11-GE.xml::$FG/MD-11"
rm -rf "$TMP"
