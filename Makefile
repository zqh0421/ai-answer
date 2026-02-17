PYTHON ?= python3
PIP ?= $(PYTHON) -m pip
VENV ?= .venv
ACTIVATE = . $(VENV)/bin/activate
APP ?= api.index:app
HOST ?= 0.0.0.0
PORT ?= 8000

.PHONY: help install reinstall dev run shell clean clean-venv deps

help:
	@echo "Common targets:"
	@echo "  make install    # create venv and install Python deps"
	@echo "  make dev        # run uvicorn with --reload"
	@echo "  make run        # run uvicorn once without reload"
	@echo "  make deps       # update dependencies after editing requirements.txt"
	@echo "  make shell      # start an interactive shell inside the venv"
	@echo "  make clean      # remove temporary artifacts"

$(VENV)/bin/activate: requirements.txt
	$(PYTHON) -m venv $(VENV)
	$(ACTIVATE); $(PIP) install --upgrade pip
	$(ACTIVATE); $(PIP) install -r requirements.txt

install: $(VENV)/bin/activate

reinstall:
	rm -rf $(VENV)
	$(MAKE) install

dev: $(VENV)/bin/activate
	$(ACTIVATE); uvicorn $(APP) --reload --host $(HOST) --port $(PORT)

run: $(VENV)/bin/activate
	$(ACTIVATE); uvicorn $(APP) --host $(HOST) --port $(PORT)

deps: $(VENV)/bin/activate
	$(ACTIVATE); $(PIP) install -r requirements.txt

shell: $(VENV)/bin/activate
	$(ACTIVATE); exec $(SHELL)

clean:
	rm -rf __pycache__ */__pycache__ *.pyc .pytest_cache

clean-venv:
	rm -rf $(VENV)
