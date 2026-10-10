"""Merchant connector framework (target §3, §50): the canonical
commerce model stays fixed while merchant systems plug in through
adapters. Custom REST/API sources work today; Shopify/WooCommerce/ERP
land as mapping configs plus thin subclasses (see docs/CONNECTORS.md).
"""

from __future__ import annotations
