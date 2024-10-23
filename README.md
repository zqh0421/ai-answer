# MuFIN - Information Retrieval

## Getting Started

### IDE

Recommended to start the project on [GitPod.io](https://gitpod.io/workspaces) or [GitHub CodeSpaces](https://github.com/codespaces/new).

These two cloud-hosted IDEs both provide free usage credits per month.

### Create virtual environment

```bash
python3 -m venv venv
# for Mac/Linux
source venv/bin/activate
# for Windows
# venv\Scripts\activate
```

### Prepare enviroment variable(s)

- Create a `.env.local` file.
- Modify the content in the `.env.local` file referring to the format in the `.env.example` file.

### Install dependencies

```bash
pip install -r requirements.txt
sudo apt-get update
sudo apt-get install poppler-utils
sudo apt install postgresql postgresql-contrib

curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
export NVM_DIR="$([ -z "${XDG_CONFIG_HOME-}" ] && printf %s "${HOME}/.nvm" || printf %s "${XDG_CONFIG_HOME}/nvm")"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" # This loads nvm

nvm --version # To check if nvm is installed correctly

nvm install 20.17.0

nvm use 20.17.0

npm install -g pnpm
pnpm install
```

### Run the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Open [http://localhost:3000/docs](http://localhost:3000/docs) with your browser to see the API documents.

### Create and Connect to Database
```bash
docker-compose up
psql -h localhost -U postgres -d mufin # Password: postgress
```

### Database Settings
```bash
sudo apt-get install wget ca-certificates
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt/ $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
sudo apt-get update
sudo apt-get install postgresql-client-17
```

After entering database mode:
```sql
\dt  -- Check all tables
INSERT INTO users (id, image, name, email, role) VALUES (1, 'N/A', 'User', 'user@example.com', 'admin'); -- Change this to the inforamtion you are using for login accordingly
SELECT * FROM users;  -- Check User Data
```

### How to start your dev work

The backend API entrance are defined in `/api/index.py`.

The UI entrance is defined in `/app/page.tsx`.

<!-- ## Additional Commands for Convenience

```bash
uvicorn app.index:app --reload
```
```bash
pip freeze > requirements.txt
```
```bash
deactivate
``` -->
