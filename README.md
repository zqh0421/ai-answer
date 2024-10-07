# MuFIN - Information Retrieval

## Getting Started

### Create virtual environment

```bash
python3 -m venv venv
# for Mac/Linux
source venv/bin/activate
# for Windows
venv\Scripts\activate
```

### Prepare enviroment variable(s)

- Create a `.env.local` file.
- Modify the content in the `.env.local` file referring to the format in the `.env.example` file.

### Install dependencies

```bash
pip install -r requirements.txt

sudo apt-get update
sudo apt-get install poppler-utils

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

### How to start your dev work

The backend API entrance are defined in `/api/index.py`.

The UI entrance is defined in `/app/page.tsx`.

## Additional Commands for Convenience

```bash
uvicorn app.index:app --reload
```
```bash
pip freeze > requirements.txt
```
```bash
deactivate
```