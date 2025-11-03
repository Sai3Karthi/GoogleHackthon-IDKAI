# Test Module 4 Complete Flow
# This script tests: fetch from Module 3 -> upload -> debate

import requests
import json
import time

BASE_URL = "http://127.0.0.1:8004"
MODULE3_URL = "http://127.0.0.1:8003"

def test_health():
    """Test health endpoint"""
    print("\n" + "="*60)
    print("TEST 1: Health Check")
    print("="*60)
    
    response = requests.get(f"{BASE_URL}/api/health")
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    return response.status_code == 200

def test_upload_perspectives():
    """Fetch perspectives from Module 3 and upload to Module 4"""
    print("\n" + "="*60)
    print("TEST 2: Upload Perspectives from Module 3")
    print("="*60)
    
    try:
        # Fetch perspectives from Module 3
        print("Fetching perspectives from Module 3...")
        leftist_response = requests.get(f"{MODULE3_URL}/module3/output/leftist", timeout=5)
        common_response = requests.get(f"{MODULE3_URL}/module3/output/common", timeout=5)
        rightist_response = requests.get(f"{MODULE3_URL}/module3/output/rightist", timeout=5)
        
        if not all([leftist_response.ok, common_response.ok, rightist_response.ok]):
            print(f"✗ Failed to fetch from Module 3")
            print(f"  Leftist: {leftist_response.status_code}")
            print(f"  Common: {common_response.status_code}")
            print(f"  Rightist: {rightist_response.status_code}")
            return False
        
        leftist = leftist_response.json()
        common = common_response.json()
        rightist = rightist_response.json()
        
        print(f"✓ Fetched {len(leftist)} leftist, {len(common)} common, {len(rightist)} rightist")
        
        # Upload to Module 4
        print("Uploading to Module 4...")
        upload_data = {
            "leftist": leftist,
            "common": common,
            "rightist": rightist,
            "input": {"topic": "Test", "text": "Test"}
        }
        
        upload_response = requests.post(f"{BASE_URL}/upload-perspectives", json=upload_data)
        
        if upload_response.status_code == 200:
            data = upload_response.json()
            print(f"✓ Upload successful")
            print(f"  {json.dumps(data['counts'], indent=2)}")
            return True
        else:
            print(f"✗ Upload failed: {upload_response.text}")
            return False
            
    except Exception as e:
        print(f"✗ Error: {e}")
        return False

def test_debate():
    """Test debate endpoint"""
    print("\n" + "="*60)
    print("TEST 3: Start Debate (with simple perspectives)")
    print("="*60)
    
    print("Sending POST to /api/debate...")
    response = requests.post(f"{BASE_URL}/api/debate", params={"use_enriched": False})
    
    print(f"Status: {response.status_code}")
    
    if response.status_code == 200:
        data = response.json()
        print(f"\n✓ Debate completed successfully!")
        print(f"  Topic: {data.get('topic', 'N/A')[:80]}...")
        print(f"  Trust Score: {data.get('trust_score', 'N/A')}%")
        print(f"  Total Rounds: {data.get('total_rounds', 'N/A')}")
        print(f"  Transcript Entries: {len(data.get('debate_transcript', []))}")
        print(f"\n  Judgment: {data.get('judgment', 'N/A')[:200]}...")
        return True
    else:
        print(f"✗ Debate failed: {response.text}")
        return False

def test_get_debate_result():
    """Test getting debate result"""
    print("\n" + "="*60)
    print("TEST 4: Get Debate Result")
    print("="*60)
    
    response = requests.get(f"{BASE_URL}/api/debate/result")
    print(f"Status: {response.status_code}")
    
    if response.status_code == 200:
        data = response.json()
        print(f"✓ Retrieved debate result")
        print(f"  Trust Score: {data.get('trust_score', 'N/A')}%")
        return True
    else:
        print(f"Response: {response.text}")
        return False

def main():
    print("\n" + "="*60)
    print("MODULE 4 COMPLETE FLOW TEST")
    print("="*60)
    
    results = {}
    
    # Test 1: Health
    results['health'] = test_health()
    time.sleep(1)
    
    # Test 2: Upload perspectives from Module 3
    results['upload'] = test_upload_perspectives()
    time.sleep(1)
    
    # Test 3: Debate (this will take a while due to AI calls)
    print("\n⚠ Note: Debate test will take 1-2 minutes due to AI processing...")
    results['debate'] = test_debate()
    time.sleep(1)
    
    # Test 4: Get result
    results['get_result'] = test_get_debate_result()
    
    # Summary
    print("\n" + "="*60)
    print("TEST SUMMARY")
    print("="*60)
    for test_name, passed in results.items():
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"{test_name.upper()}: {status}")
    
    all_passed = all(results.values())
    print("\n" + "="*60)
    if all_passed:
        print("✓ ALL TESTS PASSED!")
    else:
        print("✗ SOME TESTS FAILED")
    print("="*60)
    
    return all_passed

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
