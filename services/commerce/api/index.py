import sys, types
# Shim for razorpay which imports pkg_resources (removed in Python 3.12+)
if 'pkg_resources' not in sys.modules:
    _pkg = types.ModuleType('pkg_resources')
    _pkg.get_distribution = lambda *a, **k: types.SimpleNamespace(version='0.0.0')
    _pkg.DistributionNotFound = Exception
    sys.modules['pkg_resources'] = _pkg

from sellable.main import app

