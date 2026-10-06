// Source: Google Maps Platform Code Assist
import React, { useState, useEffect, useCallback } from 'react';
import {
  APIProvider,
  Map,
  AdvancedMarker,
  MapMouseEvent,
} from '@vis.gl/react-google-maps';
import {
  X,
  MapPin,
  Crosshair,
  Navigation,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Search,
  Loader2,
} from 'lucide-react';
import { GoogleLocation } from '../types';

interface GoogleLocationPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectLocation: (loc: GoogleLocation) => void;
  initialLocation?: GoogleLocation | null;
  title?: string;
  subtitle?: string;
}

// Default center: Nashik City Commercial / APMC Market Hub
const DEFAULT_CENTER = { lat: 19.9975, lng: 73.7898 };

// Safely extracts numeric lat/lng from any Google Maps LatLng object, function, or literal
const extractCoords = (ll: any): { lat: number; lng: number } | null => {
  if (!ll) return null;
  const rawLat = typeof ll.lat === 'function' ? ll.lat() : ll.lat;
  const rawLng = typeof ll.lng === 'function' ? ll.lng() : ll.lng;
  const lat = typeof rawLat === 'number' ? rawLat : parseFloat(String(rawLat));
  const lng = typeof rawLng === 'number' ? rawLng : parseFloat(String(rawLng));
  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng };
};

export const GoogleLocationPickerModal: React.FC<GoogleLocationPickerModalProps> = ({
  isOpen,
  onClose,
  onSelectLocation,
  initialLocation,
  title = 'Select Google Maps Delivery Location',
  subtitle = 'Pinpoint your exact delivery shop or doorstep location on Google Maps',
}) => {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

  const [markerPos, setMarkerPos] = useState<{ lat: number; lng: number }>(() => {
    const lat = Number(initialLocation?.latitude);
    const lng = Number(initialLocation?.longitude);
    if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
      return { lat, lng };
    }
    return DEFAULT_CENTER;
  });

  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>(markerPos);
  const [mapZoom, setMapZoom] = useState<number>(16);
  const [detectedAddress, setDetectedAddress] = useState<string>(
    initialLocation?.formattedAddress || ''
  );
  const [isDetectingLocation, setIsDetectingLocation] = useState<boolean>(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSearching, setIsSearching] = useState<boolean>(false);

  // Sync initial location when modal opens
  useEffect(() => {
    if (isOpen) {
      const lat = Number(initialLocation?.latitude);
      const lng = Number(initialLocation?.longitude);
      if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
        const pos = { lat, lng };
        setMarkerPos(pos);
        setMapCenter(pos);
        setDetectedAddress(initialLocation?.formattedAddress || '');
      } else {
        setMarkerPos(DEFAULT_CENTER);
        setMapCenter(DEFAULT_CENTER);
      }
      setLocationError(null);
    }
  }, [isOpen, initialLocation]);

  // Reverse geocode via REST or Geocoder
  const reverseGeocode = useCallback(
    async (lat: number, lng: number) => {
      try {
        if (!apiKey) {
          setDetectedAddress(`Location: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
          return;
        }

        const res = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`
        );
        const data = await res.json();
        if (data.status === 'OK' && data.results && data.results.length > 0) {
          const addr = data.results[0].formatted_address;
          setDetectedAddress(addr);
        } else if (data.status === 'OVER_QUERY_LIMIT') {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
          setDetectedAddress(`Pinned Location (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
        } else {
          setDetectedAddress(`Pinned Location (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
        }
      } catch (err) {
        console.error('Reverse geocode error:', err);
        setDetectedAddress(`Pinned Location (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
      }
    },
    [apiKey]
  );

  // Use GPS Current Location
  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser/device.');
      return;
    }

    setIsDetectingLocation(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const newCoords = { lat, lng };
        setMarkerPos(newCoords);
        setMapCenter(newCoords);
        setMapZoom(18);
        setIsDetectingLocation(false);
        reverseGeocode(lat, lng);
      },
      (err) => {
        setIsDetectingLocation(false);
        let msg = 'Unable to retrieve GPS coordinates.';
        if (err.code === err.PERMISSION_DENIED) {
          msg = 'GPS permission denied. You can tap anywhere on the map or drag the pin to select your location.';
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          msg = 'Location unavailable. Please tap directly on the map or drag the pin to select your location.';
        } else if (err.code === err.TIMEOUT) {
          msg = 'GPS request timed out. Please tap directly on the map or drag the pin.';
        }
        setLocationError(msg);
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 10000,
      }
    );
  };

  // Handle map click to place pin (works completely without GPS permission)
  const handleMapClick = (e: MapMouseEvent) => {
    const coords = extractCoords(e.detail?.latLng);
    if (coords) {
      setMarkerPos(coords);
      setLocationError(null);
      reverseGeocode(coords.lat, coords.lng);
    }
  };

  // Search address using Geocoding API
  const handleSearchAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim() || !apiKey) return;

    setIsSearching(true);
    setLocationError(null);

    try {
      // Append region or country if not present
      const queryWithRegion = `${searchQuery.trim()}, Maharashtra, India`;
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
          queryWithRegion
        )}&key=${apiKey}`
      );
      const data = await res.json();
      if (data.status === 'OK' && data.results && data.results.length > 0) {
        const first = data.results[0];
        const lat = first.geometry.location.lat;
        const lng = first.geometry.location.lng;
        const newPos = { lat, lng };
        setMarkerPos(newPos);
        setMapCenter(newPos);
        setMapZoom(16);
        setDetectedAddress(first.formatted_address);
      } else if (data.status === 'OVER_QUERY_LIMIT') {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        setLocationError('Search quota limit reached. Please tap directly on the map to set your location.');
      } else {
        setLocationError(`No Google Maps location found for "${searchQuery}". Try tapping directly on the map.`);
      }
    } catch (err) {
      console.error('Search location error:', err);
      setLocationError('Failed to search location. Please check your network connection.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleConfirmLocation = () => {
    const lat = Number(markerPos?.lat) || DEFAULT_CENTER.lat;
    const lng = Number(markerPos?.lng) || DEFAULT_CENTER.lng;
    const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
    const selectedLocation: GoogleLocation = {
      latitude: Number(lat.toFixed(6)),
      longitude: Number(lng.toFixed(6)),
      formattedAddress: detectedAddress || `Latitude: ${lat.toFixed(5)}, Longitude: ${lng.toFixed(5)}`,
      mapsUrl,
    };
    onSelectLocation(selectedLocation);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      id="google-location-picker-modal"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-2.5 sm:p-4 overflow-y-auto animate-in fade-in duration-200"
    >
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden border-t-4 border-[#0F2C59] flex flex-col max-h-[92vh] my-auto">
        {/* Header */}
        <div className="bg-[#0F2C59] text-white p-3.5 sm:p-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#D4AF37]/20 border border-[#D4AF37]/40 flex items-center justify-center text-[#D4AF37]">
              <MapPin size={18} />
            </div>
            <div>
              <h3 className="font-extrabold text-sm sm:text-base text-[#D4AF37] leading-tight">
                {title}
              </h3>
              <p className="text-[11px] text-gray-300 mt-0.5">{subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-300 hover:text-white p-1 rounded-lg hover:bg-white/10 transition cursor-pointer"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search & Actions Bar */}
        <div className="p-3 bg-gray-50 border-b border-gray-200 space-y-2 shrink-0">
          <form onSubmit={handleSearchAddress} className="flex gap-2">
            <div className="relative flex-1">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                placeholder="Search area, landmark or road (e.g. APMC Market, CIDCO, MG Road)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-xs border border-gray-300 rounded-xl outline-none focus:border-[#0F2C59] bg-white font-medium"
              />
            </div>
            <button
              type="submit"
              disabled={isSearching || !searchQuery.trim()}
              className="px-3.5 py-2 bg-[#0F2C59] hover:bg-[#163a6e] text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
            >
              {isSearching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
              <span>Search</span>
            </button>
          </form>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              id="btn-use-current-gps-location"
              onClick={handleUseCurrentLocation}
              disabled={isDetectingLocation}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 active:scale-95"
            >
              {isDetectingLocation ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Crosshair size={13} className="text-emerald-200" />
              )}
              <span>{isDetectingLocation ? 'Detecting GPS...' : 'Use My Current Location'}</span>
            </button>

            <span className="text-[11px] text-gray-600 font-medium">
              Tip: Tap map or drag pin to select location (GPS not required)
            </span>
          </div>

          {locationError && (
            <div className="p-2 bg-amber-50 border border-amber-300 text-amber-900 rounded-xl text-xs flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle size={14} className="text-amber-600 shrink-0" />
                <span className="truncate">{locationError}</span>
              </div>
              <button
                type="button"
                onClick={() => setLocationError(null)}
                className="text-amber-700 hover:text-amber-900 text-[10px] font-bold underline shrink-0 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>

        {/* Google Map Viewport */}
        <div className="relative w-full h-72 sm:h-80 bg-gray-100 shrink-0 overflow-hidden">
          {apiKey ? (
            <APIProvider apiKey={apiKey}>
              <Map
                style={{ width: '100%', height: '100%' }}
                defaultCenter={DEFAULT_CENTER}
                center={mapCenter}
                onCenterChanged={(e) => setMapCenter(e.detail.center)}
                defaultZoom={16}
                zoom={mapZoom}
                onZoomChanged={(e) => setMapZoom(e.detail.zoom)}
                mapId="DEMO_MAP_ID"
                internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                onClick={handleMapClick}
                gestureHandling="greedy"
                disableDefaultUI={false}
              >
                <AdvancedMarker
                  position={markerPos}
                  draggable={true}
                  onDragEnd={(e) => {
                    const coords = extractCoords(e.latLng);
                    if (coords) {
                      setMarkerPos(coords);
                      setLocationError(null);
                      reverseGeocode(coords.lat, coords.lng);
                    }
                  }}
                  title="Your Delivery Location"
                />
              </Map>
            </APIProvider>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-gray-600">
              <MapPin size={36} className="text-[#FF6B00] mb-2" />
              <p className="font-bold text-xs">Google Maps API key configured</p>
              <p className="text-[11px] text-gray-500 mt-1 max-w-sm">
                Coordinates: {markerPos.lat.toFixed(5)}, {markerPos.lng.toFixed(5)}
              </p>
            </div>
          )}
        </div>

        {/* Selected Coordinates & Address Footer */}
        <div className="p-3.5 sm:p-4 bg-white border-t border-gray-200 space-y-3">
          <div className="bg-blue-50/70 border border-blue-200/80 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="space-y-0.5 min-w-0">
              <div className="text-[10px] font-black uppercase tracking-wider text-[#0F2C59] flex items-center gap-1">
                <Navigation size={11} className="text-[#FF6B00]" />
                <span>Selected Google Location</span>
              </div>
              <p className="text-xs font-bold text-gray-900 truncate">
                {detectedAddress || 'Selected on Google Maps'}
              </p>
              <p className="text-[11px] font-mono text-gray-600">
                Lat: {Number(markerPos?.lat)?.toFixed ? Number(markerPos.lat).toFixed(5) : markerPos.lat}, Lng:{' '}
                {Number(markerPos?.lng)?.toFixed ? Number(markerPos.lng).toFixed(5) : markerPos.lng}
              </p>
            </div>

            <a
              href={`https://www.google.com/maps?q=${markerPos.lat},${markerPos.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-bold text-blue-700 hover:text-blue-900 underline flex items-center gap-1 shrink-0 self-start sm:self-center"
              title="Open pin in Google Maps"
            >
              <ExternalLink size={12} />
              <span>Verify in Google Maps</span>
            </a>
          </div>

          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-gray-600 hover:bg-gray-100 font-bold text-xs transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              id="btn-confirm-google-location"
              onClick={handleConfirmLocation}
              className="px-4 py-2 rounded-xl bg-[#0F2C59] hover:bg-[#163a6e] text-[#D4AF37] font-extrabold text-xs shadow-md hover:shadow-lg transition flex items-center gap-1.5 cursor-pointer active:scale-95"
            >
              <CheckCircle2 size={14} className="text-emerald-400" />
              <span>Use This Google Location</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
