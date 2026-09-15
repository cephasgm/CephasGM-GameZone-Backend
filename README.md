\# CephasGM GameZone — Backend API



> REST + WebSocket backend for \*\*CephasGM GameZone\*\* — sports betting, casino, virtual games (Football, Horse Racing, Car Racing, Netball, Aviator), wallet, KYC, bonuses, referrals.



\---



\## Tech Stack



| Layer | Technology |

|-------|------------|

| Runtime | Node.js 20 LTS |

| Framework | Express 4 |

| Database | PostgreSQL 16 |

| ORM | Prisma 5 |

| Auth | JWT (access + refresh) + bcrypt |

| Validation | Zod |

| Real-time | Socket.io |

| Payments | Flutterwave, M-Pesa, Tigo Pesa, Airtel Money |

| Logging | Pino |

| Jobs | node-cron |



\---



\## Quick Start



\### Prerequisites



\- Node.js 20+

\- PostgreSQL 16 (local or Docker)

\- Redis (optional)



\### Install



&#x20;   git clone https://github.com/cephasgm/CephasGM-GameZone-Backend.git

&#x20;   cd CephasGM-GameZone-Backend

&#x20;   npm install



\### Configure



&#x20;   cp .env.example .env



Edit `.env` with your `DATABASE\_URL` and JWT secrets.



Generate secrets:



&#x20;   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"



\### Database Setup



&#x20;   npm run db:setup



\### Run



&#x20;   npm run dev              # development (hot reload)

&#x20;   npm start                # production

&#x20;   docker compose up -d     # via Docker



\---



\## Project Structure



&#x20;   cephasgm-backend/

&#x20;   ├── prisma/               # Schema, migrations, seed

&#x20;   ├── src/

&#x20;   │   ├── config/           # Env, DB, logger

&#x20;   │   ├── middleware/       # Auth, validation, errors

&#x20;   │   ├── routes/           # Express routers

&#x20;   │   ├── controllers/      # Request handlers

&#x20;   │   ├── services/         # Business logic

&#x20;   │   ├── validators/       # Zod schemas

&#x20;   │   ├── sockets/          # Socket.io handlers

&#x20;   │   ├── jobs/             # Scheduled tasks

&#x20;   │   ├── utils/            # Helpers

&#x20;   │   ├── app.js

&#x20;   │   └── server.js

&#x20;   ├── docker-compose.yml

&#x20;   ├── Dockerfile

&#x20;   └── package.json



\---



\## Available Scripts



| Script | Purpose |

|--------|---------|

| `npm run dev` | Start with hot reload |

| `npm start` | Production server |

| `npm run db:setup` | Generate + migrate + seed |

| `npm run prisma:migrate` | Create a new migration |

| `npm run prisma:studio` | Open DB GUI |

| `npm run lint` | Run ESLint |

| `npm test` | Run tests |



\---



\## API Overview



All endpoints under `/api/v1`:



| Group | Base Path |

|-------|-----------|

| Auth | `/auth` |

| Users | `/users` |

| Wallet | `/wallet` |

| Transactions | `/transactions` |

| Deposits | `/deposits` |

| Withdrawals | `/withdrawals` |

| Bets | `/bets` |

| Games | `/games` |

| KYC | `/kyc` |

| Bonuses | `/bonuses` |

| Referrals | `/referrals` |

| Notifications | `/notifications` |

| Support | `/support` |

| Leaderboard | `/leaderboard` |

| Admin | `/admin` |



\*\*Health check:\*\* `GET /health`



\---



\## License



Proprietary. © 2025 Cephas GM. All rights reserved.

