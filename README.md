# MuFIN - Information Retrieval

## Getting Started

### Recommended to start the project on GitPod.io[https://gitpod.io/workspaces]

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
sudo apt-get install poppler-utils
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
