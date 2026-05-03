import http from 'node:http';
import path from 'node:path';
import { publisher, subscriber, redis } from './redis-connection.js';
import express from "express";
import { Server } from 'socket.io';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import jwt from 'jsonwebtoken';
import 'dotenv/config';

async function main() {
    callbackURL: 'https://checkboxes-production-944c.up.railway.app/auth/google/callback'
    const app = express();
    const server = http.createServer(app);
    const io = new Server(server);

    const CHECKBOX_SIZE = 1_000_000;
    const CHECKBOXSTATE_KEY = 'checkboxes';

    // ─── Session + Passport setup ───────────────────────────────────────────
    app.use(session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false
    }));
    app.use(passport.initialize());
    app.use(passport.session());

    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: '/auth/google/callback'
    }, (accessToken, refreshToken, profile, done) => {
        const user = {
            id: profile.id,
            name: profile.displayName,
            email: profile.emails[0].value
        };
        return done(null, user);
    }));

    passport.serializeUser((user, done) => done(null, user));
    passport.deserializeUser((user, done) => done(null, user));

    // ─── Auth Routes ────────────────────────────────────────────────────────
    app.get('/auth/google',
        passport.authenticate('google', { scope: ['profile', 'email'] })
    );

    app.get('/auth/google/callback',
        passport.authenticate('google', { failureRedirect: '/' }),
        (req, res) => {
            const token = jwt.sign(
                { id: req.user.id, name: req.user.name, email: req.user.email },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );
            // Token URL mein de do, frontend localStorage mein save karega
            res.redirect(`/?token=${token}`);
        }
    );

    app.get('/auth/logout', (req, res) => {
        req.logout(() => res.redirect('/'));
    });

    // ─── Socket.IO Auth Middleware ───────────────────────────────────────────
    io.use((socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) {
            socket.isAnonymous = true;  // anonymous = read only
            return next();
        }
        try {
            const user = jwt.verify(token, process.env.JWT_SECRET);
            socket.userId = user.id;
            socket.userName = user.name;
            socket.isAnonymous = false;
            next();
        } catch {
            socket.isAnonymous = true;
            next();
        }
    });

    // ─── Redis Subscribe ─────────────────────────────────────────────────────
    await subscriber.subscribe('internal-server:checkbox:change');

    subscriber.on('message', (channel, message) => {
        if (channel === 'internal-server:checkbox:change') {
            const { index, checked } = JSON.parse(message);
            io.emit('server:checkbox:change', { index, checked });
        }
    });

    // ─── Socket Events ───────────────────────────────────────────────────────
    io.on('connection', (socket) => {
        console.log(`Socket Connected`, { id: socket.id, user: socket.userName ?? 'anonymous' });

        socket.on('client:checkbox:change', async (data) => {

            //  Anonymous users toggle nahi kar sakte
            if (socket.isAnonymous) {
                socket.emit('server:error', { error: 'Please login to toggle checkboxes!' });
                return;
            }

            // ⏱️ Rate limiting — per user, 5.5 sec window
            const rateLimitKey = `rate-limiting:${socket.userId}`;
            const lastOperationTime = await redis.get(rateLimitKey);

            if (lastOperationTime) {
                const timeLapsed = Date.now() - lastOperationTime;
                if (timeLapsed < 5500) {
                    const waitSec = ((5500 - timeLapsed) / 1000).toFixed(1);
                    socket.emit('server:error', { error: `Please wait ${waitSec}s before next toggle.` });
                    return;
                }
            }
            await redis.set(rateLimitKey, Date.now(), 'EX', 10);

            let state = await redis.get(CHECKBOXSTATE_KEY);
            state = state ? JSON.parse(state) : new Array(CHECKBOX_SIZE).fill(false);

            state[data.index] = data.checked;
            await redis.set(CHECKBOXSTATE_KEY, JSON.stringify(state));

            await publisher.publish(
                'internal-server:checkbox:change',
                JSON.stringify(data)
            );
        });

        socket.on('disconnect', () => {
            console.log(`Socket Disconnected`, { id: socket.id });
        });
    });

    // ─── Static + API Routes ─────────────────────────────────────────────────
    app.use(express.static(path.resolve('./public')));

    app.get('/health', (req, res) => res.json({ healthy: true }));

    app.get('/checkboxes', async (req, res) => {
        let state = await redis.get(CHECKBOXSTATE_KEY);
        if (!state) {
            const initial = new Array(CHECKBOX_SIZE).fill(false);
            await redis.set(CHECKBOXSTATE_KEY, JSON.stringify(initial));
            return res.json({ checkboxes: initial });
        }
        return res.json({ checkboxes: JSON.parse(state) });
    });

    const PORT = process.env.PORT ?? 3000;
    server.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

main();