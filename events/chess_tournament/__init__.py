"""chess_tournament - a Swiss-system chess event.

The package is picked up automatically by ``events/__init__.py`` and
``routes.py`` registers the Flask blueprint exposed by ``routes.py`` inside
it. Nothing is imported here on purpose, so importing the package never has
side effects and deleting the whole folder simply removes the event.

* ``config.py``  - manager list, paths, limits.
* ``store.py``   - tournament state on disk.
* ``swiss.py``   - pairings, colours, standings, Buchholz Cut 1.
* ``routes.py``  - public page, manager dashboard and JSON API.
"""
