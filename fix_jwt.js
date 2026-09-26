const fs = require('fs');
let c = fs.readFileSync('./backend/cashier-module/jwt-middleware.js', 'utf8');

// Fix: prevent double response in catch block
const oldCatch = `    } catch (err) {
        // Without this catch an async DB failure leaves the request hanging
        // (Express 4 does not route rejected handlers to the error middleware)
        logger.error('[auth] login failed:', err.message);
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر تسجيل الدخول — حاول مرة أخرى' });
    } finally {`;

const newCatch = `    } catch (err) {
        // Without this catch an async DB failure leaves the request hanging
        // (Express 4 does not route rejected handlers to the error middleware)
        logger.error('[auth] login failed:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر تسجيل الدخول — حاول مرة أخرى' });
        }
    } finally {`;

if (c.includes(oldCatch)) {
    c = c.replace(oldCatch, newCatch);
    console.log("Fixed double response in catch block");
} else {
    console.log("Pattern not found - already fixed or different format");
}

fs.writeFileSync('./backend/cashier-module/jwt-middleware.js', c);
console.log("Done");
