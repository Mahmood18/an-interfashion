# A.N. Inter Fashions

The responsive homepage presents the company story, production figures,
product collections, facility, export markets,
and inquiry details in a corporate textile-supplier layout. The homepage hero
uses local bedroom/clothes-rack and neatly rolled towel photographs sourced
from Pexels under the Pexels license.

## Run the site and API

Requires Node.js. From this folder, run:

```sh
npm start
```

Open `http://localhost:3000`. The homepage and About, Products, Facility,
Export, and Contact pages each have their own route. Page content,
product categories, and filtering are loaded through the API.

## Page API

- `GET /api/pages` returns the available pages and titles.
- `GET /api/pages/home` returns the complete homepage content.
- `GET /api/pages/about` returns the About page content.
- Page endpoints are also available for `products`, `facility`, `export`, and `contact`.

## Product API

- `GET /api/categories` returns the available product categories.
- `GET /api/products` returns all products.
- `GET /api/products?category=women` returns products in a category. Supported
  category IDs include `men`, `women`, `bottoms`, `fleece`, `uniform`,
  `kitchen-towels`, and `bar-mops`. The `all` filter is the default and is not
  shown as a product category.
