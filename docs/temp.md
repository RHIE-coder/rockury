│ 📦 │  ← Object Browser (스키마 오브젝트)

```
┌────────────────────────┐
│ OBJECTS                │
├────────────────────────┤
│ 🔍 Search objects...   │
├────────────────────────┤
│ 📋 Schema: public  ▾  │  ← PG only (schema selector)
├────────────────────────┤
│ ▸ 🗂 Tables (42)       │
│ ▸ 👁 Views (8)         │
│ ▸ 🔮 Materialized (3)  │  ← PG only
│ ▸ ⚡ Functions (15)     │
│ ▸ 📜 Procedures (5)    │
│ ▸ ⏰ Triggers (12)     │
│ ▸ 🔢 Sequences (7)     │  ← PG + MariaDB
│ ▸ 📅 Events (2)        │  ← MySQL/MariaDB only
│ ▸ 🏷 Types (4)         │  ← PG only
│ ▸ 🧩 Extensions (6)    │  ← PG only
│ ▸ 🛡 Policies (3)      │  ← PG only
│ ▸ 🌐 Domains (1)       │  ← PG only
├────────────────────────┤
│ [↻ Refresh]            │
└────────────────────────┘
```

### SQLite Object Browser

> SQLite는 파일 기반 DB로 지원 오브젝트가 제한적.
> DBA/Monitor 기능 대부분 불가 — Object Browser + Data Ops만 활성.

```
┌────────────────────────┐
│ OBJECTS                │
├────────────────────────┤
│ 🔍 Search objects...   │
├────────────────────────┤
│ ▸ 🗂 Tables (15)       │
│ ▸ 👁 Views (3)         │
│ ▸ 📇 Indexes (8)       │  ← SQLite: 독립 카테고리로 표시
│ ▸ ⏰ Triggers (2)      │
├────────────────────────┤
│ ── DB Info ──          │
│ 📄 File: ~/data/app.db │
│ 📏 Size: 24.3 MB       │
│ 🔖 SQLite 3.45.0       │
│ 📐 Page Size: 4096     │
│ 📊 Page Count: 6,225   │
├────────────────────────┤
│ [↻ Refresh]            │
└────────────────────────┘
```

```
│ 👤 │  ← DBA (유저/권한/설정) Administrator

┌──────────────────────────┐
│ DBA                      │
├──────────────────────────┤
│ 🔍 Search...             │
├──────────────────────────┤
│ ▸ 👤 Users (12)          │
│ ▸ 🎭 Roles (5)           │
│ ▸ 🛡 Privileges           │
│ ▸ 🗄 Databases (3)        │
│ ▸ 📐 Schemas (4)          │  ← PG only
│ ▸ ⚙ Variables             │
│ ▸ 📊 Server Status        │
└──────────────────────────┘

│ 📊 │  ← Monitor (세션/성능/통계)

┌──────────────────────────┐
│ MONITOR                  │
├──────────────────────────┤
│ ▸ 🖥 Active Sessions      │
│ ▸ 🔒 Locks                │
│ ▸ 📊 Table Statistics      │
│ ▸ 📈 Index Statistics      │
│ ▸ 🏆 Top SQL               │
│ ▸ 🖧 Server Status         │
│ ▸ 📡 Replication           │  ← 연결 설정에 따라
└──────────────────────────┘

│ 📥 │  ← Data Ops (Import/Export) 

┌──────────────────────────┐
│ DATA OPS                 │
├──────────────────────────┤
│ 📤 Export Data            │
│ 📥 Import Data            │
│ 💾 SQL Dump               │
│ 📂 Restore                │
└──────────────────────────┘
```


------


