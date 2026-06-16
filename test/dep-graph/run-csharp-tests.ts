/**
 * C# dependency graph test runner
 *
 * Tests parsing of User.cs, UserService.cs, IEntity.cs, IUserService.cs
 * Validates: symbols, imports, calls, heritage
 */
import { AuraParser } from '../../server/services/aura/parser.ts'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const TEST_DIR = __dirname

let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++
  } else {
    failed++
    console.error(`  ✗ FAIL: ${message}`)
  }
}

async function main() {
  const parser = new AuraParser()
  await parser.init()
  console.log('Parser initialized\n')

  // ─── User.cs ───
  console.log('=== User.cs ===')
  const userResult = await parser.parseFile(path.join(TEST_DIR, 'User.cs'), `using System;
using System.Collections.Generic;
using MyApp.Services;

namespace MyApp.Models
{
    public interface IRepository<T>
    {
        T FindById(int id);
        void Save(T entity);
    }

    public enum UserRole
    {
        Admin,
        User,
        Guest
    }

    public class User : IEntity
    {
        public int Id { get; set; }
        public string Name { get; set; }

        public User(int id, string name)
        {
            Id = id;
            Name = name;
        }

        public void Display()
        {
            Console.WriteLine($"User: {Name}");
        }
    }

    public delegate void NotifyHandler(string message);
}`)

  // Symbols
  const userSymbols = userResult.symbols
  assert(userSymbols.length >= 6, `User.cs symbols >= 6, got ${userSymbols.length}`)
  const userClass = userSymbols.find(s => s.name === 'User')
  assert(!!userClass, 'User class found')
  assert(userClass?.kind === 'Class', `User is Class, got ${userClass?.kind}`)
  const iRepo = userSymbols.find(s => s.name === 'IRepository')
  assert(!!iRepo, 'IRepository interface found')
  assert(iRepo?.kind === 'Interface', `IRepository is Interface, got ${iRepo?.kind}`)
  const userRole = userSymbols.find(s => s.name === 'UserRole')
  assert(!!userRole, 'UserRole enum found')
  assert(userRole?.kind === 'Enum', `UserRole is Enum, got ${userRole?.kind}`)
  const notifyHandler = userSymbols.find(s => s.name === 'NotifyHandler')
  assert(!!notifyHandler, 'NotifyHandler delegate found')
  assert(notifyHandler?.kind === 'Delegate', `NotifyHandler is Delegate, got ${notifyHandler?.kind}`)
  const ns = userSymbols.find(s => s.name === 'MyApp.Models')
  assert(!!ns, 'MyApp.Models namespace found')
  assert(ns?.kind === 'Namespace', `MyApp.Models is Namespace, got ${ns?.kind}`)
  const display = userSymbols.find(s => s.name === 'Display')
  assert(!!display, 'Display method found')
  assert(display?.kind === 'Method', `Display is Method, got ${display?.kind}`)
  const ctor = userSymbols.find(s => s.name === 'User()' && s.kind === 'Method')
  assert(!!ctor, 'User constructor found')
  const idProp = userSymbols.find(s => s.name === 'Id')
  assert(!!idProp, 'Id property found')
  const nameProp = userSymbols.find(s => s.name === 'Name')
  assert(!!nameProp, 'Name property found')

  // Imports
  const userImports = userResult.imports
  assert(userImports.length >= 3, `User.cs imports >= 3, got ${userImports.length}`)
  const systemImport = userImports.find(i => i.target === 'System')
  assert(!!systemImport, 'using System found')
  const collectionsImport = userImports.find(i => i.target === 'System.Collections.Generic')
  assert(!!collectionsImport, 'using System.Collections.Generic found')
  const servicesImport = userImports.find(i => i.target === 'MyApp.Services')
  assert(!!servicesImport, 'using MyApp.Services found')

  // Heritage
  const userHeritage = userResult.heritage
  const extendsIEntity = userHeritage.find(h => h.target === 'IEntity')
  assert(!!extendsIEntity, 'User extends IEntity found')
  if (extendsIEntity) {
    assert(extendsIEntity.type === 'EXTENDS' || extendsIEntity.type === 'IMPLEMENTS',
      `User→IEntity heritage type: ${extendsIEntity.type}`)
  }

  // Calls
  const userCalls = userResult.calls
  const consoleCall = userCalls.find(c => c.metadata?.callName?.includes('Console'))
  assert(!!consoleCall, `Console call found in User.cs`)

  // ─── UserService.cs ───
  console.log('\n=== UserService.cs ===')
  const userServiceResult = await parser.parseFile(path.join(TEST_DIR, 'UserService.cs'), `using System;
using MyApp.Models;

namespace MyApp.Services
{
    public class UserService : IUserService
    {
        private readonly IRepository<User> _repository;

        public UserService(IRepository<User> repository)
        {
            _repository = repository;
        }

        public User GetUser(int id)
        {
            return _repository.FindById(id);
        }

        public void SaveUser(User user)
        {
            _repository.Save(user);
        }
    }
}`)

  const userServiceSymbols = userServiceResult.symbols
  assert(userServiceSymbols.length >= 4, `UserService.cs symbols >= 4, got ${userServiceSymbols.length}`)
  const userServiceClass = userServiceSymbols.find(s => s.name === 'UserService')
  assert(!!userServiceClass, 'UserService class found')
  assert(userServiceClass?.kind === 'Class', `UserService is Class, got ${userServiceClass?.kind}`)
  const getUser = userServiceSymbols.find(s => s.name === 'GetUser')
  assert(!!getUser, 'GetUser method found')
  const saveUser = userServiceSymbols.find(s => s.name === 'SaveUser')
  assert(!!saveUser, 'SaveUser method found')

  // Heritage
  const userServiceHeritage = userServiceResult.heritage
  const implementsIUserService = userServiceHeritage.find(h => h.target === 'IUserService')
  assert(!!implementsIUserService, 'UserService implements IUserService found')

  // Calls
  const userServiceCalls = userServiceResult.calls
  const findByIdCall = userServiceCalls.find(c => c.metadata?.callName?.includes('FindById'))
  assert(!!findByIdCall, 'FindById call found')
  const saveCall = userServiceCalls.find(c => c.metadata?.callName?.includes('Save'))
  assert(!!saveCall, 'Save call found')

  // ─── IEntity.cs ───
  console.log('\n=== IEntity.cs ===')
  const iEntityResult = await parser.parseFile(path.join(TEST_DIR, 'IEntity.cs'), `using System;

namespace MyApp.Models
{
    public interface IEntity
    {
        int Id { get; set; }
    }
}`)

  const iEntitySymbols = iEntityResult.symbols
  assert(iEntitySymbols.length >= 3, `IEntity.cs symbols >= 3, got ${iEntitySymbols.length}`)
  const iEntity = iEntitySymbols.find(s => s.name === 'IEntity')
  assert(!!iEntity, 'IEntity interface found')
  assert(iEntity?.kind === 'Interface', `IEntity is Interface, got ${iEntity?.kind}`)

  // ─── IUserService.cs ───
  console.log('\n=== IUserService.cs ===')
  const iUserServiceResult = await parser.parseFile(path.join(TEST_DIR, 'IUserService.cs'), `using MyApp.Models;

namespace MyApp.Services
{
    public interface IUserService
    {
        User GetUser(int id);
        void SaveUser(User user);
    }
}`)

  const iUserServiceSymbols = iUserServiceResult.symbols
  assert(iUserServiceSymbols.length >= 3, `IUserService.cs symbols >= 3, got ${iUserServiceSymbols.length}`)
  const iUserService = iUserServiceSymbols.find(s => s.name === 'IUserService')
  assert(!!iUserService, 'IUserService interface found')
  assert(iUserService?.kind === 'Interface', `IUserService is Interface, got ${iUserService?.kind}`)
  const getUserInIface = iUserServiceSymbols.find(s => s.name === 'GetUser')
  assert(!!getUserInIface, 'GetUser method in IUserService found')
  const saveUserInIface = iUserServiceSymbols.find(s => s.name === 'SaveUser')
  assert(!!saveUserInIface, 'SaveUser method in IUserService found')

  // Imports
  const iUserServiceImports = iUserServiceResult.imports
  assert(iUserServiceImports.length >= 1, `IUserService.cs imports >= 1, got ${iUserServiceImports.length}`)
  const modelsImport = iUserServiceImports.find(i => i.target === 'MyApp.Models')
  assert(!!modelsImport, 'using MyApp.Models found')

  // ─── Summary ───
  console.log(`\n${'='.repeat(40)}`)
  console.log(`C# Tests: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Test runner error:', err)
  process.exit(1)
})