#!/usr/bin/env node
// karim-erp.js — alias for KARIMERP.bat (one-click installer & service runner)
// Delegates to install.js which handles: Node/PG install, DB init, migrations, Windows services.
require('./install.js');
